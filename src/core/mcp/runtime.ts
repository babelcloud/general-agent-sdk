import type { AgentTool, AgentToolResult } from "../../loop/agent-types.js";
import type { GeneralAgentMcpServerConfig } from "../../public/types.js";
import type { McpClient, McpListedTool } from "./client-types.js";
import { HttpMcpClient } from "./http-client.js";
import { StdioMcpClient } from "./stdio-client.js";

export type DynamicMcpToolRuntime = {
  tools: AgentTool[];
  dispose(): Promise<void>;
};

export async function createDynamicMcpToolRuntime(params: {
  workspaceDir: string;
  servers: Array<{ serverName: string; config: GeneralAgentMcpServerConfig }>;
  reservedToolNames: string[];
}): Promise<DynamicMcpToolRuntime> {
  if (params.servers.length === 0) {
    return {
      tools: [],
      async dispose() {},
    };
  }

  const clients: McpClient[] = [];
  const tools: AgentTool[] = [];
  const usedToolNames = new Set(params.reservedToolNames);

  try {
    for (const server of params.servers) {
      const client = createMcpClient(server.config, params.workspaceDir);
      clients.push(client);
      await client.initialize();

      const listedTools = await client.listTools();
      for (const tool of listedTools) {
        if (usedToolNames.has(tool.name)) {
          throw new Error(`MCP tool name collision: ${tool.name}`);
        }
        usedToolNames.add(tool.name);
        tools.push(createMcpAgentTool(server.serverName, tool, client));
      }
    }

    return {
      tools,
      async dispose() {
        await Promise.allSettled(clients.map((client) => client.close()));
      },
    };
  } catch (error) {
    await Promise.allSettled(clients.map((client) => client.close()));
    throw error;
  }
}

function createMcpClient(
  config: GeneralAgentMcpServerConfig,
  workspaceDir: string,
): McpClient {
  if (config.transport === "stdio") {
    return new StdioMcpClient(config, workspaceDir);
  }

  if (config.transport === "http") {
    return new HttpMcpClient(config);
  }

  const _exhaustive: never = config;
  return _exhaustive;
}

function createMcpAgentTool(
  serverName: string,
  tool: McpListedTool,
  client: McpClient,
): AgentTool {
  return {
    name: tool.name,
    label: `${serverName}:${tool.name}`,
    description: tool.description ?? `MCP tool ${tool.name} from ${serverName}`,
    parameters: tool.inputSchema ?? {
      type: "object",
      properties: {},
    },
    async execute(_toolCallId, params): Promise<AgentToolResult<any>> {
      const result = await client.callTool(tool.name, params);
      if (result?.isError) {
        throw new Error(extractMcpErrorText(result));
      }
      return {
        content: normalizeMcpContent(result?.content),
        details: {
          serverName,
          ...result,
        },
      };
    },
  };
}

function normalizeMcpContent(content: unknown): AgentToolResult<any>["content"] {
  if (!Array.isArray(content) || content.length === 0) {
    return [{ type: "text", text: "" }];
  }

  const normalized: AgentToolResult<any>["content"] = [];
  for (const entry of content) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const candidate = entry as {
        type?: string;
        text?: string;
        data?: string;
        mimeType?: string;
      };

      if (candidate.type === "text" && typeof candidate.text === "string") {
        normalized.push({ type: "text", text: candidate.text });
        continue;
      }
      if (
        candidate.type === "image" &&
        typeof candidate.data === "string" &&
        typeof candidate.mimeType === "string"
      ) {
        normalized.push({
          type: "image",
          data: candidate.data,
          mimeType: candidate.mimeType,
        });
        continue;
      }
    }
    normalized.push({ type: "text", text: JSON.stringify(entry) });
  }

  return normalized.length > 0 ? normalized : [{ type: "text", text: "" }];
}

function extractMcpErrorText(result: any): string {
  const firstText = Array.isArray(result?.content)
    ? result.content.find(
        (entry: unknown): entry is { type: "text"; text: string } =>
          Boolean(
            entry &&
              typeof entry === "object" &&
              !Array.isArray(entry) &&
              (entry as { type?: string }).type === "text" &&
              typeof (entry as { text?: string }).text === "string",
          ),
      )
    : undefined;

  return firstText?.text ?? "MCP tool execution failed";
}

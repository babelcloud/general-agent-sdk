import type {
  OpenClawHostedToolErrorInput,
  OpenClawHostedToolResultInput,
} from "../../public/host-tools.js";
import type { OpenClawAgentSdk } from "../../public/sdk.js";
import type {
  OpenClawCompactionOptions,
  OpenClawCurrentQueryLike,
  OpenClawSessionParams,
  OpenClawUsageSnapshot,
} from "../../public/types.js";

export type VisionClawCompatUserContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | {
          type: "tool_result";
          tool_use_id: string;
          content: unknown;
          is_error?: boolean;
        }
      | {
          type: "image";
          source: { type: "base64"; media_type: string; data: string };
        }
    >;

export type VisionClawCompatStreamMessage =
  | {
      type: "assistant";
      session_id?: string;
      message: {
        role: "assistant";
        content: Array<
          | { type: "text"; text: string }
          | { type: "thinking"; thinking: string }
          | { type: "tool_use"; name: string; input: unknown; id?: string }
        >;
      };
      parent_tool_use_id?: string | null;
    }
  | {
      type: "user";
      session_id?: string;
      message: {
        role: "user";
        content: Array<{
          type: "tool_result";
          tool_use_id: string;
          content: unknown;
          is_error?: boolean;
        }>;
      };
      parent_tool_use_id?: string | null;
    }
  | {
      type: "result";
      subtype: string;
      num_turns: number;
      usage: {
        input_tokens: number;
        output_tokens: number;
      };
      total_cost_usd: number;
      is_error: boolean;
    }
  | {
      type: "system";
      subtype: string;
      session_id?: string;
      [key: string]: unknown;
    };

export type VisionClawHostedToolExecution =
  | { ok: true; output: unknown }
  | { ok: false; error: string };

export interface VisionClawHostedToolExecutor {
  execute(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<VisionClawHostedToolExecution>;
}

export interface VisionClawCompatSessionLike {
  sendAndStream(
    content: VisionClawCompatUserContent,
  ): AsyncIterable<VisionClawCompatStreamMessage>;
  injectMessage(content: VisionClawCompatUserContent): boolean;
  closeInput(): void;
  requestStop(): void;
  clearStop(): void;
  isStopRequested(): boolean;
  requestCompaction(): Promise<void>;
  maybeCompactByTokens(
    options?: OpenClawCompactionOptions,
  ): Promise<void>;
  captureSessionId(id: string | undefined): void;
  captureUsageSnapshot(snapshot: {
    usedInputTokens: number;
    contextWindow: number;
    usedPct: number;
    capturedAtMs?: number;
  }): void;
  capturePostCompactionSnapshot(postCompactionTokens: number): void;
  getSessionId(): string | null;
  getTranscriptPath(): string | null;
  getUsageSnapshot(): OpenClawUsageSnapshot | null;
  getCurrentQuery(): OpenClawCurrentQueryLike | null;
  setDynamicMcpServers(servers: Record<string, Record<string, unknown>>): void;
  getDynamicMcpServers(): Record<string, Record<string, unknown>>;
  readonly hasOrphanedInjections: boolean;
  readonly isInputClosed: boolean;
}

export interface VisionClawSessionAdapterArgs {
  sdk: OpenClawAgentSdk;
  sessionParams: OpenClawSessionParams;
  hostedToolExecutor: VisionClawHostedToolExecutor;
  initialDynamicMcpServers?: Record<string, Record<string, unknown>>;
}

export type HostedToolResumeInput =
  | OpenClawHostedToolResultInput
  | OpenClawHostedToolErrorInput;

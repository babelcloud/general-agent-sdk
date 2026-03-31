import type { AgentTool, AgentToolResult } from "../../loop/agent-types.js";
import type { GeneralAgentHostedToolDefinition } from "../../public/host-tools.js";

/**
 * A pending hosted tool call waiting for the host to provide a result.
 */
export interface PendingHostedCall {
  callId: string;
  toolName: string;
  input: Record<string, unknown>;
  resolve: (result: AgentToolResult<any>) => void;
  reject: (error: Error) => void;
}

/**
 * Bridge between the vendored agent loop and the hosted tool protocol.
 *
 * When the agent loop calls execute() on a hosted tool, the bridge:
 * 1. Records the pending call
 * 2. Returns a Promise that blocks the loop
 * 3. When the host calls submitResult/submitError, resolves the Promise
 * 4. The loop resumes with the result
 */
export class HostedToolBridge {
  private pending: PendingHostedCall | null = null;
  private readonly errorResults = new Set<string>();

  /**
   * Wrap a hosted tool definition as an AgentTool.
   * The execute() method blocks until the host provides a result.
   */
  createAgentTool(def: GeneralAgentHostedToolDefinition): AgentTool {
    return {
      name: def.name,
      label: def.name,
      description: def.description,
      parameters: def.inputSchema ?? { type: "object", properties: {} },
      execute: async (
        toolCallId: string,
        params: any,
      ): Promise<AgentToolResult<any>> => {
        return new Promise<AgentToolResult<any>>((resolve, reject) => {
          this.pending = {
            callId: toolCallId,
            toolName: def.name,
            input: (params ?? {}) as Record<string, unknown>,
            resolve,
            reject,
          };
        });
      },
    };
  }

  /**
   * Get the current pending call, if any.
   */
  getPending(): PendingHostedCall | null {
    return this.pending;
  }

  /**
   * Check if there's a pending hosted tool call.
   */
  hasPending(): boolean {
    return this.pending !== null;
  }

  /**
   * Provide a result for the pending hosted tool call.
   */
  submitResult(callId: string, output: unknown, details: unknown = output): void {
    if (!this.pending || this.pending.callId !== callId) {
      throw new Error(`No pending hosted tool call for callId: ${callId}`);
    }
    const p = this.pending;
    this.pending = null;
    p.resolve({
      content: [{ type: "text", text: typeof output === "string" ? output : JSON.stringify(output) }],
      details,
    });
  }

  /**
   * Provide an error for the pending hosted tool call.
   */
  submitError(callId: string, error: string, details: unknown = { error }): void {
    if (!this.pending || this.pending.callId !== callId) {
      throw new Error(`No pending hosted tool call for callId: ${callId}`);
    }
    const p = this.pending;
    this.pending = null;
    this.errorResults.add(callId);
    p.resolve({
      content: [{ type: "text", text: error }],
      details,
    });
  }

  consumeSubmittedError(callId: string): boolean {
    if (!this.errorResults.has(callId)) {
      return false;
    }
    this.errorResults.delete(callId);
    return true;
  }

  hasSubmittedError(callId: string): boolean {
    return this.errorResults.has(callId);
  }
}

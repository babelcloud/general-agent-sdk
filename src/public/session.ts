import type {
  OpenClawHostedToolErrorInput,
  OpenClawHostedToolResultInput,
} from "./host-tools.js";
import type { OpenClawStreamEvent } from "./events.js";
import type {
  OpenClawCompactionOptions,
  OpenClawCurrentQueryLike,
  OpenClawTurnInput,
  OpenClawUsageSnapshot,
} from "./types.js";

export interface OpenClawAgentSession {
  streamTurn(input: OpenClawTurnInput): AsyncIterable<OpenClawStreamEvent>;
  injectMessage(input: OpenClawTurnInput): boolean;
  submitHostedToolResult(
    input: OpenClawHostedToolResultInput,
  ): AsyncIterable<OpenClawStreamEvent>;
  submitHostedToolError(
    input: OpenClawHostedToolErrorInput,
  ): AsyncIterable<OpenClawStreamEvent>;
  requestStop(): void;
  clearStop(): void;
  isStopRequested(): boolean;
  requestCompaction(): Promise<void>;
  maybeCompactByTokens(options?: OpenClawCompactionOptions): Promise<void>;
  getSessionId(): string;
  getTranscriptPath(): string | null;
  getUsageSnapshot(): OpenClawUsageSnapshot | null;
  getCurrentQuery(): OpenClawCurrentQueryLike | null;
  setDynamicMcpServers(servers: Record<string, Record<string, unknown>>): void;
  getDynamicMcpServers(): Record<string, Record<string, unknown>>;
  closeInput(): void;
}

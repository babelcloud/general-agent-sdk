import type {
  GeneralAgentHostedToolErrorInput,
  GeneralAgentHostedToolResultInput,
} from "./host-tools.js";
import type { GeneralAgentStreamEvent } from "./events.js";
import type {
  GeneralAgentCompactionOptions,
  GeneralAgentCurrentQueryLike,
  GeneralAgentTurnInput,
  GeneralAgentUsageSnapshot,
} from "./types.js";

export interface GeneralAgentAgentSession {
  streamTurn(input: GeneralAgentTurnInput): AsyncIterable<GeneralAgentStreamEvent>;
  injectMessage(input: GeneralAgentTurnInput): boolean;
  submitHostedToolResult(
    input: GeneralAgentHostedToolResultInput,
  ): AsyncIterable<GeneralAgentStreamEvent>;
  submitHostedToolError(
    input: GeneralAgentHostedToolErrorInput,
  ): AsyncIterable<GeneralAgentStreamEvent>;
  requestStop(): void;
  clearStop(): void;
  isStopRequested(): boolean;
  requestCompaction(): Promise<void>;
  maybeCompactByTokens(options?: GeneralAgentCompactionOptions): Promise<void>;
  getSessionId(): string;
  getTranscriptPath(): string | null;
  getUsageSnapshot(): GeneralAgentUsageSnapshot | null;
  getCurrentQuery(): GeneralAgentCurrentQueryLike | null;
  setDynamicMcpServers(servers: Record<string, Record<string, unknown>>): void;
  getDynamicMcpServers(): Record<string, Record<string, unknown>>;
  closeInput(): void;
}

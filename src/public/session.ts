import type {
  GeneralAgentHostedToolErrorInput,
  GeneralAgentHostedToolResultInput,
} from "./host-tools.js";
import type { GeneralAgentStreamEvent } from "./events.js";
import type {
  GeneralAgentCompactionOptions,
  GeneralAgentCurrentQueryLike,
  GeneralAgentFileCheckpoint,
  GeneralAgentMcpServerConfig,
  GeneralAgentTurnInput,
  GeneralAgentUsageSnapshot,
} from "./types.js";

export interface GeneralAgentSession {
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
  reset(reason?: string): Promise<void>;
  requestCompaction(): Promise<void>;
  maybeCompactByTokens(options?: GeneralAgentCompactionOptions): Promise<void>;
  getSessionId(): string;
  getTranscriptPath(): string | null;
  getUsageSnapshot(): GeneralAgentUsageSnapshot | null;
  getCurrentQuery(): GeneralAgentCurrentQueryLike | null;
  listCheckpoints(): Promise<GeneralAgentFileCheckpoint[]>;
  restoreCheckpoint(id: string): Promise<void>;
  setDynamicMcpServers(servers: Record<string, GeneralAgentMcpServerConfig>): void;
  getDynamicMcpServers(): Record<string, GeneralAgentMcpServerConfig>;
  closeInput(): void;
}

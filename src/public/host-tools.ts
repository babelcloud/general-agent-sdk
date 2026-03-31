export interface GeneralAgentHostedToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface GeneralAgentHostedToolResultInput {
  callId: string;
  output: unknown;
  details?: unknown;
}

export interface GeneralAgentHostedToolErrorInput {
  callId: string;
  error: string;
  details?: unknown;
}

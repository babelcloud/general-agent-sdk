export interface OpenClawHostedToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface OpenClawHostedToolResultInput {
  callId: string;
  output: unknown;
}

export interface OpenClawHostedToolErrorInput {
  callId: string;
  error: string;
}

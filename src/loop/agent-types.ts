import type {
	AssistantMessage,
	AssistantMessageEvent,
	AssistantMessageEventStream,
	ImageContent,
	Message,
	Model,
	SimpleStreamOptions,
	TextContent,
	Tool,
	ToolResultMessage,
} from "../providers/anthropic-types.js";

/**
 * Stream function used by the agent loop.
 */
export type StreamFn = (
	model: Model<any>,
	context: import("../providers/anthropic-types.js").Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

/**
 * Configuration for how tool calls from a single assistant message are executed.
 */
export type ToolExecutionMode = "sequential" | "parallel";

/** A single tool call content block emitted by an assistant message. */
export type AgentToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

export interface BeforeToolCallResult {
	args?: unknown;
	block?: boolean;
	reason?: string;
}

export interface AfterToolCallResult {
	content?: (TextContent | ImageContent)[];
	details?: unknown;
	isError?: boolean;
}

export interface BeforeToolCallContext {
	assistantMessage: AssistantMessage;
	toolCall: AgentToolCall;
	args: unknown;
	context: AgentContext;
}

export interface AfterToolCallContext {
	assistantMessage: AssistantMessage;
	toolCall: AgentToolCall;
	args: unknown;
	result: AgentToolResult<any>;
	isError: boolean;
	context: AgentContext;
}

export interface AgentLoopConfig extends SimpleStreamOptions {
	model: Model<any>;

	convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

	transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;

	getSteeringMessages?: () => Promise<AgentMessage[]>;

	getFollowUpMessages?: () => Promise<AgentMessage[]>;

	toolExecution?: ToolExecutionMode;

	beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;

	afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface CustomAgentMessages {
	// Empty by default - apps extend via declaration merging
}

export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

export interface AgentState {
	systemPrompt: string;
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	tools: AgentTool<any>[];
	messages: AgentMessage[];
	isStreaming: boolean;
	streamMessage: AgentMessage | null;
	pendingToolCalls: Set<string>;
	error?: string;
}

export interface AgentToolResult<T> {
	content: (TextContent | ImageContent)[];
	details: T;
}

export type AgentToolUpdateCallback<T = any> = (partialResult: AgentToolResult<T>) => void;

export interface AgentTool<TParameters = any, TDetails = any> extends Tool<TParameters> {
	label: string;
	execute: (
		toolCallId: string,
		params: any,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TDetails>,
	) => Promise<AgentToolResult<TDetails>>;
}

export interface AgentContext {
	systemPrompt: string;
	messages: AgentMessage[];
	tools?: AgentTool<any>[];
}

export type AgentEvent =
	| { type: "agent_start" }
	| { type: "agent_end"; messages: AgentMessage[] }
	| { type: "turn_start" }
	| { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
	| { type: "message_start"; message: AgentMessage }
	| { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
	| { type: "message_end"; message: AgentMessage }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
	| { type: "tool_execution_update"; toolCallId: string; toolName: string; args: any; partialResult: any }
	| { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean };

import { describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "../../../src/loop/agent-loop.js";
import type { AgentContext, AgentEvent, AgentTool } from "../../../src/loop/agent-types.js";
import type { AssistantMessage, Message, Model, UserMessage } from "../../../src/providers/anthropic-types.js";
import { AssistantMessageEventStream } from "../../../src/providers/event-stream.js";

describe("agent loop types", () => {
	it("AgentEvent type exists and has known shapes", () => {
		const startEvent: AgentEvent = { type: "agent_start" };
		expect(startEvent.type).toBe("agent_start");

		const endEvent: AgentEvent = { type: "agent_end", messages: [] };
		expect(endEvent.type).toBe("agent_end");
	});

	it("runs afterToolCall for blocked tool outcomes", async () => {
		const toolExecute = vi.fn(async () => ({
			content: [{ type: "text" as const, text: "should not run" }],
			details: {},
		}));
		const tool: AgentTool = {
			name: "finish",
			label: "finish",
			description: "finish the task",
			parameters: { type: "object", properties: {} },
			execute: toolExecute,
		};

		const assistantMessage: AssistantMessage = {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "call-1",
					name: "finish",
					arguments: { step: 1 },
				},
			],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "openai/gpt-5.4",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0,
				},
			},
			stopReason: "toolUse",
			timestamp: Date.now(),
		};
		const finalAssistantMessage: AssistantMessage = {
			...assistantMessage,
			content: [{ type: "text", text: "blocked" }],
			stopReason: "stop",
			timestamp: Date.now() + 1,
		};

		const events: AgentEvent[] = [];
		const afterToolCall = vi.fn(async () => undefined);
		const userMessage: UserMessage = {
			role: "user",
			content: "finish now",
			timestamp: Date.now(),
		};
		const context: AgentContext = {
			systemPrompt: "Use finish immediately.",
			messages: [],
			tools: [tool],
		};
		const model: Model<"anthropic-messages"> = {
			id: "openai/gpt-5.4",
			name: "GPT-5.4",
			api: "anthropic-messages",
			provider: "anthropic",
			baseUrl: "https://api.example.test",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200_000,
			maxTokens: 16_000,
		};
		let streamCallCount = 0;

		await runAgentLoop(
			[userMessage],
			context,
			{
				model,
				apiKey: "test-api-key",
				convertToLlm: async (messages) => messages as Message[],
				beforeToolCall: async () => ({
					block: true,
					reason: "blocked by policy",
				}),
				afterToolCall,
			},
			async (event) => {
				events.push(event);
			},
			undefined,
			() => {
				const stream = new AssistantMessageEventStream();
				streamCallCount += 1;
				stream.push({
					type: "done",
					reason: streamCallCount === 1 ? "toolUse" : "stop",
					message: streamCallCount === 1 ? assistantMessage : finalAssistantMessage,
				});
				return stream;
			},
		);

		expect(toolExecute).not.toHaveBeenCalled();
		expect(afterToolCall).toHaveBeenCalledTimes(1);
		expect(afterToolCall.mock.calls[0]?.[0]).toMatchObject({
			toolCall: {
				id: "call-1",
				name: "finish",
			},
			args: { step: 1 },
			isError: true,
		});
		const toolEnd = events.find(
			(event): event is Extract<AgentEvent, { type: "tool_execution_end" }> =>
				event.type === "tool_execution_end",
		);
		expect(toolEnd?.isError).toBe(true);
	});
});

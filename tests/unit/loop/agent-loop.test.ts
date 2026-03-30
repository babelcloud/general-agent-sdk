import { describe, it, expect } from "vitest";
import type { AgentEvent } from "../../../src/loop/agent-types.js";

describe("agent loop types", () => {
	it("AgentEvent type exists and has known shapes", () => {
		const startEvent: AgentEvent = { type: "agent_start" };
		expect(startEvent.type).toBe("agent_start");

		const endEvent: AgentEvent = { type: "agent_end", messages: [] };
		expect(endEvent.type).toBe("agent_end");
	});
});

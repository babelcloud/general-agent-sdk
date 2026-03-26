import { describe, expect, it } from "vitest";
import {
  createOpenClawAgentSdk,
  type OpenClawAgentSdk,
  type OpenClawAgentSdkOptions,
  type OpenClawAgentSession,
  type OpenClawSessionParams,
  type OpenClawStreamEvent,
} from "../../src/index.js";

describe("public API", () => {
  it("exports the session-first SDK surface", () => {
    expect(typeof createOpenClawAgentSdk).toBe("function");

    type _Sdk = OpenClawAgentSdk;
    type _Options = OpenClawAgentSdkOptions;
    type _Session = OpenClawAgentSession;
    type _SessionParams = OpenClawSessionParams;
    type _StreamEvent = OpenClawStreamEvent;

    expect(true).toBe(true);
  });
});

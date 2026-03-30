import { describe, expect, it } from "vitest";
import {
  createGeneralAgentAgentSdk,
  type GeneralAgentAgentSdk,
  type GeneralAgentAgentSdkOptions,
  type GeneralAgentAgentSession,
  type GeneralAgentSessionParams,
  type GeneralAgentStreamEvent,
} from "../../src/index.js";

describe("public API", () => {
  it("exports the session-first SDK surface", () => {
    expect(typeof createGeneralAgentAgentSdk).toBe("function");

    type _Sdk = GeneralAgentAgentSdk;
    type _Options = GeneralAgentAgentSdkOptions;
    type _Session = GeneralAgentAgentSession;
    type _SessionParams = GeneralAgentSessionParams;
    type _StreamEvent = GeneralAgentStreamEvent;

    expect(true).toBe(true);
  });
});

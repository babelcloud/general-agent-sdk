const DENIED_TOOL_NAMES = new Set(["message", "gateway", "cron", "nodes", "subagents"]);

export function isToolAllowedInEmbeddedMode(name: string): boolean {
  if (DENIED_TOOL_NAMES.has(name)) {
    return false;
  }

  if (name.startsWith("sessions_")) {
    return false;
  }

  return true;
}

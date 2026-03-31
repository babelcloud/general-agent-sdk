import { isSdkReservedToolName } from "./tool-catalog.js";

export function isToolAllowedInEmbeddedMode(name: string): boolean {
  return !isSdkReservedToolName(name);
}

import type {
  VisionClawCompatSessionLike,
  VisionClawSessionAdapterArgs,
} from "./types.js";

export function createVisionClawSessionAdapter(
  _args: VisionClawSessionAdapterArgs,
): VisionClawCompatSessionLike {
  throw new Error("VisionClaw compat session adapter is not implemented yet");
}

import type { OpenClawSessionStoreAdapter } from "../../public/persistence.js";
import type { OpenClawSessionIdentity } from "../../public/types.js";

export async function resolveHostSessionFile(
  store: OpenClawSessionStoreAdapter,
  identity: OpenClawSessionIdentity,
  explicitSessionFile?: string,
): Promise<string> {
  if (explicitSessionFile) {
    return explicitSessionFile;
  }

  return store.resolveSessionFile(identity);
}

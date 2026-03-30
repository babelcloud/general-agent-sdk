import type { GeneralAgentSessionStoreAdapter } from "../../public/persistence.js";
import type { GeneralAgentSessionIdentity } from "../../public/types.js";

export async function resolveHostSessionFile(
  store: GeneralAgentSessionStoreAdapter,
  identity: GeneralAgentSessionIdentity,
  explicitSessionFile?: string,
): Promise<string> {
  if (explicitSessionFile) {
    return explicitSessionFile;
  }

  return store.resolveSessionFile(identity);
}

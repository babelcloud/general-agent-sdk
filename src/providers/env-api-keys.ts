export function getEnvApiKey(provider: string): string | undefined {
	if (provider === "anthropic") {
		return process.env.ANTHROPIC_API_KEY;
	}
	return undefined;
}

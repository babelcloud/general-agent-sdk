import * as dns from "node:dns/promises";
import { isIP } from "node:net";
import { URL } from "node:url";

/**
 * SSRF protection: blocks requests to private IPs, localhost, and internal hostnames.
 * Fail-closed: if we can't parse or resolve, we block.
 */

const BLOCKED_HOSTNAME_SUFFIXES = [
	".localhost",
	".local",
	".internal",
	".localdomain",
	".home.arpa",
	".corp",
];

const BLOCKED_HOSTNAMES = new Set([
	"localhost",
	"metadata.google.internal",
	"169.254.169.254", // AWS/GCP metadata
	"[::1]",
]);

let resolveDnsImpl = (hostname: string) => dns.resolve(hostname);

export function isBlockedHostname(hostname: string): boolean {
	const lower = hostname.toLowerCase();
	if (BLOCKED_HOSTNAMES.has(lower)) return true;
	for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
		if (lower.endsWith(suffix)) return true;
	}
	return false;
}

/**
 * Check if an IP address is private/reserved.
 * Fail-closed: returns true for unparseable input.
 */
export function isPrivateIpAddress(ip: string): boolean {
	// Handle IPv4-mapped IPv6
	const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
	if (mapped) {
		return isPrivateIpV4(mapped[1]);
	}

	// IPv6 loopback
	if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") return true;

	// IPv6 link-local
	if (ip.toLowerCase().startsWith("fe80:")) return true;

	// IPv6 unique local
	if (ip.toLowerCase().startsWith("fc") || ip.toLowerCase().startsWith("fd")) return true;

	// IPv4
	if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
		return isPrivateIpV4(ip);
	}

	// Fail closed: if we can't parse it, block it
	return true;
}

function isPrivateIpV4(ip: string): boolean {
	const parts = ip.split(".").map(Number);
	if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
		return true; // Fail closed
	}

	const [a, b, c, d] = parts;

	// 127.0.0.0/8 (loopback)
	if (a === 127) return true;
	// 10.0.0.0/8
	if (a === 10) return true;
	// 172.16.0.0/12
	if (a === 172 && b >= 16 && b <= 31) return true;
	// 192.168.0.0/16
	if (a === 192 && b === 168) return true;
	// 169.254.0.0/16 (link-local)
	if (a === 169 && b === 254) return true;
	// 0.0.0.0/8 (current network)
	if (a === 0) return true;
	// 100.64.0.0/10 (carrier-grade NAT)
	if (a === 100 && b >= 64 && b <= 127) return true;
	// 198.18.0.0/15 (benchmark)
	if (a === 198 && (b === 18 || b === 19)) return true;
	// 224.0.0.0/4 (multicast)
	if (a >= 224 && a <= 239) return true;
	// 240.0.0.0/4 (reserved)
	if (a >= 240) return true;

	return false;
}

/**
 * Validate a URL is safe to fetch (not SSRF target).
 * Resolves DNS and checks the resolved IP against block list.
 */
export async function validateUrlForFetch(urlString: string): Promise<{ safe: boolean; reason?: string }> {
	let url: URL;
	try {
		url = new URL(urlString);
	} catch {
		return { safe: false, reason: "Invalid URL" };
	}

	// Only allow HTTP(S)
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return { safe: false, reason: `Blocked protocol: ${url.protocol}` };
	}

	const hostname = url.hostname;

	// Check hostname against block list
	if (isBlockedHostname(hostname)) {
		return { safe: false, reason: `Blocked hostname: ${hostname}` };
	}

	// Check if hostname is already an IP
	const ip = hostname.replace(/^\[|\]$/g, "");
	if (isIP(ip) > 0) {
		if (isPrivateIpAddress(ip)) {
			return { safe: false, reason: `Blocked private IP: ${ip}` };
		}
		return { safe: true };
	}

	// Resolve DNS and check resolved IP
	try {
		const addresses = await resolveDnsImpl(hostname);
		if (!addresses.length) {
			return { safe: false, reason: `DNS resolution failed: ${hostname}` };
		}
		for (const addr of addresses) {
			if (isPrivateIpAddress(addr)) {
				return { safe: false, reason: `DNS resolved to private IP: ${addr}` };
			}
		}
	} catch {
		return { safe: false, reason: `DNS resolution failed: ${hostname}` };
	}

	return { safe: true };
}

export const __testing = {
	setDnsResolverForTests(resolver: typeof resolveDnsImpl) {
		resolveDnsImpl = resolver;
	},
	resetDnsResolverForTests() {
		resolveDnsImpl = (hostname: string) => dns.resolve(hostname);
	},
};

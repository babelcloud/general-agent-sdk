import { describe, it, expect } from "vitest";
import { isPrivateIpAddress, isBlockedHostname } from "../../../src/tools/web/ssrf.js";

describe("SSRF protection", () => {
	describe("isBlockedHostname", () => {
		it("blocks localhost", () => {
			expect(isBlockedHostname("localhost")).toBe(true);
		});
		it("blocks *.localhost", () => {
			expect(isBlockedHostname("evil.localhost")).toBe(true);
		});
		it("blocks *.local", () => {
			expect(isBlockedHostname("router.local")).toBe(true);
		});
		it("blocks *.internal", () => {
			expect(isBlockedHostname("service.internal")).toBe(true);
		});
		it("blocks metadata.google.internal", () => {
			expect(isBlockedHostname("metadata.google.internal")).toBe(true);
		});
		it("allows normal hostnames", () => {
			expect(isBlockedHostname("example.com")).toBe(false);
			expect(isBlockedHostname("api.github.com")).toBe(false);
		});
	});

	describe("isPrivateIpAddress", () => {
		it("blocks 127.0.0.0/8", () => {
			expect(isPrivateIpAddress("127.0.0.1")).toBe(true);
			expect(isPrivateIpAddress("127.255.255.255")).toBe(true);
		});
		it("blocks 10.0.0.0/8", () => {
			expect(isPrivateIpAddress("10.0.0.1")).toBe(true);
			expect(isPrivateIpAddress("10.255.255.255")).toBe(true);
		});
		it("blocks 172.16.0.0/12", () => {
			expect(isPrivateIpAddress("172.16.0.1")).toBe(true);
			expect(isPrivateIpAddress("172.31.255.255")).toBe(true);
		});
		it("blocks 192.168.0.0/16", () => {
			expect(isPrivateIpAddress("192.168.0.1")).toBe(true);
			expect(isPrivateIpAddress("192.168.255.255")).toBe(true);
		});
		it("blocks 169.254.0.0/16 (link-local)", () => {
			expect(isPrivateIpAddress("169.254.169.254")).toBe(true);
		});
		it("blocks ::1 (IPv6 loopback)", () => {
			expect(isPrivateIpAddress("::1")).toBe(true);
		});
		it("blocks IPv4-mapped IPv6", () => {
			expect(isPrivateIpAddress("::ffff:127.0.0.1")).toBe(true);
			expect(isPrivateIpAddress("::ffff:10.0.0.1")).toBe(true);
		});
		it("allows public IPs", () => {
			expect(isPrivateIpAddress("8.8.8.8")).toBe(false);
			expect(isPrivateIpAddress("1.1.1.1")).toBe(false);
			expect(isPrivateIpAddress("142.250.80.46")).toBe(false);
		});
		it("fails closed on invalid input", () => {
			expect(isPrivateIpAddress("not-an-ip")).toBe(true);
		});
	});
});

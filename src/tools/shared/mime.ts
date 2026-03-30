import { readFileSync } from "node:fs";

/**
 * Detect supported image MIME type from file magic bytes.
 * Returns null for non-images or unsupported formats.
 */
export function detectSupportedImageMimeTypeFromFile(filePath: string): string | null {
	try {
		const fd = readFileSync(filePath, { flag: "r" });
		const header = fd.subarray(0, 16);
		if (header.length < 4) return null;

		// PNG: 89 50 4E 47
		if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
			return "image/png";
		}
		// JPEG: FF D8 FF
		if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
			return "image/jpeg";
		}
		// GIF: 47 49 46 38
		if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38) {
			return "image/gif";
		}
		// WebP: 52 49 46 46 ... 57 45 42 50
		if (
			header.length >= 12 &&
			header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
			header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50
		) {
			return "image/webp";
		}

		return null;
	} catch {
		return null;
	}
}

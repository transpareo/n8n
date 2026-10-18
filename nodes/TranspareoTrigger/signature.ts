import { createHmac, timingSafeEqual } from 'crypto';

// Deliveries older or newer than this are refused, so a captured
// delivery cannot be replayed later. Every attempt is signed anew.
const TOLERANCE_SECONDS = 300;

const HEADER = /^t=(\d+),v1=([0-9a-f]+)$/;

// `X-Transpareo-Signature: t=<unix time>,v1=<hex>`, an HMAC-SHA256 over
// `<t>.<raw body>` with the subscription's secret.
export function verifySignature(
	secret: string,
	header: string | undefined,
	rawBody: Buffer,
	nowSeconds: number,
): boolean {
	const match = HEADER.exec(String(header ?? '').trim());
	if (!secret || !match) return false;

	const [, timestamp, digest] = match;
	if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) return false;

	const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
	const given = Buffer.from(digest, 'hex');
	return given.length === expected.length && timingSafeEqual(given, expected);
}

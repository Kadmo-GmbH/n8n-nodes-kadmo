import { createHmac, timingSafeEqual } from 'node:crypto';

/** The signature header's scheme. */
export const SIGNATURE_VERSION = 'v1';

/** How far a delivery's timestamp may be from this clock, in seconds. */
export const SIGNATURE_TOLERANCE_S = 300;

const HEX_SHA256 = /^[0-9a-f]{64}$/i;
const UNIX_SECONDS = /^\d{1,15}$/;

export interface SignedDelivery {
	secret: string;
	/** `Kadmo-Signature`: one or more `v1=<hex>` values separated by commas. */
	header: string | undefined;
	/** `Kadmo-Timestamp`: Unix seconds. */
	timestamp: string | undefined;
	/** The body exactly as received. */
	rawBody: Buffer;
	/** This clock, in Unix seconds. */
	nowS: number;
}

/**
 * Kadmo's delivery check, as Kadmo documents it: the lower-case hex HMAC-SHA256 of `<timestamp>.<raw body>`, keyed
 * with the secret as shown, equals any `v1=` value of the header (compared in constant time), and the timestamp is
 * within {@link SIGNATURE_TOLERANCE_S} of this clock.
 */
export function verifySignature(delivery: SignedDelivery): boolean {
	const { secret, header, timestamp, rawBody, nowS } = delivery;
	if (!secret || !header || !timestamp) return false;
	const stamp = timestamp.trim();
	if (!UNIX_SECONDS.test(stamp)) return false;
	if (Math.abs(nowS - Number(stamp)) > SIGNATURE_TOLERANCE_S) return false;

	const expected = createHmac('sha256', Buffer.from(secret, 'utf8'))
		.update(`${stamp}.`, 'utf8')
		.update(rawBody)
		.digest();
	let matched = false;
	for (const part of header.split(',')) {
		const entry = part.trim();
		const eq = entry.indexOf('=');
		if (eq < 0 || entry.slice(0, eq).trim() !== SIGNATURE_VERSION) continue;
		const value = entry.slice(eq + 1).trim();
		if (!HEX_SHA256.test(value)) continue;
		// Every value is compared, so the time taken does not tell which one matched.
		if (timingSafeEqual(Buffer.from(value, 'hex'), expected)) matched = true;
	}
	return matched;
}

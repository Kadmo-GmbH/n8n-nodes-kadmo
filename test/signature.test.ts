import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { verifySignature } from '../nodes/Kadmo/helpers/signature';
import finished from './fixtures/api/webhook.job.finished.json';
import needsInput from './fixtures/api/webhook.job.needs_input.json';
import ping from './fixtures/api/webhook.ping.json';
import taskDone from './fixtures/api/webhook.task.done.json';

const fixtures = { finished, needsInput, ping, taskDone };
const NOW = Number(ping.headers['Kadmo-Timestamp']);

function check(fixture: typeof ping, overrides: Partial<Parameters<typeof verifySignature>[0]> = {}) {
	return verifySignature({
		secret: fixture.secret,
		header: fixture.headers['Kadmo-Signature'],
		timestamp: fixture.headers['Kadmo-Timestamp'],
		rawBody: Buffer.from(fixture.body, 'utf8'),
		nowS: NOW,
		...overrides,
	});
}

describe('verifySignature', () => {
	it.each(Object.entries(fixtures))('accepts the signed %s fixture (known answer)', (_name, fixture) => {
		expect(check(fixture)).toBe(true);
	});

	it('matches the documented ping known answer', () => {
		const secret = ping.secret;
		const body =
			'{"id":9812,"type":"ping","api_version":"v1","created_at":"2026-11-13T09:00:00.000Z","webhook_id":12,"data":{}}';
		expect(
			verifySignature({
				secret,
				header: 'v1=32b828787d27a69f5b37560ab18af0de066b426caa2608d05acbebdd458bb7c3',
				timestamp: '1794540000',
				rawBody: Buffer.from(body),
				nowS: 1794540000,
			}),
		).toBe(true);
	});

	it('refuses a changed body', () => {
		expect(check(ping, { rawBody: Buffer.from(ping.body.replace('"ping"', '"pong"')) })).toBe(false);
	});

	it('refuses a timestamp more than five minutes off, either way', () => {
		expect(check(ping, { nowS: NOW + 301 })).toBe(false);
		expect(check(ping, { nowS: NOW - 301 })).toBe(false);
		expect(check(ping, { nowS: NOW + 300 })).toBe(true);
	});

	it('refuses a missing header, timestamp or secret', () => {
		expect(check(ping, { header: undefined })).toBe(false);
		expect(check(ping, { timestamp: undefined })).toBe(false);
		expect(check(ping, { secret: '' })).toBe(false);
		expect(check(ping, { secret: 'kadmo_whsec_another' })).toBe(false);
	});

	it('refuses a timestamp that is not digits and a value that is not hex', () => {
		expect(check(ping, { timestamp: '1794540000.5' })).toBe(false);
		expect(check(ping, { header: 'v1=not-hex' })).toBe(false);
	});

	it('refuses another scheme alone, and accepts several v1 values with one right', () => {
		const value = ping.headers['Kadmo-Signature'].slice(3);
		expect(check(ping, { header: `v0=${value}` })).toBe(false);
		expect(check(ping, { header: `v1=${'0'.repeat(64)}, v0=abc,v1=${value}` })).toBe(true);
	});

	it('signs the raw bytes as received, not a re-serialised body', () => {
		const body = '{ "id": 1,  "type": "ping" }';
		const signature = createHmac('sha256', ping.secret).update(`${NOW}.${body}`).digest('hex');
		expect(check(ping, { rawBody: Buffer.from(body), header: `v1=${signature}` })).toBe(true);
		expect(
			check(ping, { rawBody: Buffer.from(JSON.stringify(JSON.parse(body))), header: `v1=${signature}` }),
		).toBe(false);
	});
});

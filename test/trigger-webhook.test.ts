import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KadmoTrigger } from '../nodes/Kadmo/KadmoTrigger.node';
import finished from './fixtures/api/webhook.job.finished.json';
import needsInput from './fixtures/api/webhook.job.needs_input.json';
import ping from './fixtures/api/webhook.ping.json';
import taskDone from './fixtures/api/webhook.task.done.json';
import { webhookContext } from './helpers/hook-context';

const NOW_MS = Number(ping.headers['Kadmo-Timestamp']) * 1000;
const trigger = new KadmoTrigger();

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW_MS);
});
afterEach(() => {
	vi.useRealTimers();
});

describe('KadmoTrigger.webhook', () => {
	it.each([
		['job.finished', finished],
		['job.needs_input', needsInput],
		['task.done', taskDone],
	])('emits one item equal to a verified %s event', async (_type, fixture) => {
		const { context, status } = webhookContext({ ...fixture, secret: fixture.secret });
		const result = await trigger.webhook.call(context);
		expect(result.workflowData).toEqual([[{ json: JSON.parse(fixture.body) }]]);
		expect(status).not.toHaveBeenCalled();
	});

	it('answers 401 and starts nothing when the signature does not match', async () => {
		const { context, status } = webhookContext({ ...finished, secret: 'kadmo_whsec_other' });
		const result = await trigger.webhook.call(context);
		expect(result).toEqual({ noWebhookResponse: true });
		expect(status).toHaveBeenCalledWith(401);
	});

	it('answers 401 when no secret is stored yet', async () => {
		const { context, status } = webhookContext({ ...finished, secret: undefined });
		expect(await trigger.webhook.call(context)).toEqual({ noWebhookResponse: true });
		expect(status).toHaveBeenCalledWith(401);
	});

	it('answers 401 for a stale delivery', async () => {
		vi.setSystemTime(NOW_MS + 301_000);
		const { context, status } = webhookContext({ ...finished, secret: finished.secret });
		expect(await trigger.webhook.call(context)).toEqual({ noWebhookResponse: true });
		expect(status).toHaveBeenCalledWith(401);
	});

	it('shows a ping while listening for a test event', async () => {
		const { context } = webhookContext({ ...ping, secret: ping.secret, mode: 'manual' });
		const result = await trigger.webhook.call(context);
		expect(result.workflowData).toEqual([[{ json: JSON.parse(ping.body) }]]);
	});

	it('acknowledges a ping on a published workflow and starts nothing', async () => {
		const { context, status, json } = webhookContext({ ...ping, secret: ping.secret, mode: 'webhook' });
		expect(await trigger.webhook.call(context)).toEqual({ noWebhookResponse: true });
		expect(status).toHaveBeenCalledWith(200);
		expect(json).toHaveBeenCalled();
	});
});

describe('KadmoTrigger.description', () => {
	it('follows the trigger conventions', () => {
		const { description } = trigger;
		expect(description.name).toBe('kadmoTrigger');
		expect(description.inputs).toEqual([]);
		expect(description.usableAsTool).toBeUndefined();
		expect(description.credentials).toEqual([{ name: 'kadmoApi', required: true }]);
		expect(description.webhooks?.[0]).toMatchObject({ name: 'default', httpMethod: 'POST', path: 'webhook' });
		const events = description.properties.find((p) => p.name === 'events');
		expect(events?.options?.map((o) => ('value' in o ? o.value : undefined))).toEqual([
			'job.finished',
			'job.needs_input',
			'task.done',
		]);
	});
});

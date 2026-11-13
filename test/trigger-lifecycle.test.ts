import { NodeApiError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { KadmoTrigger } from '../nodes/Kadmo/KadmoTrigger.node';
import created from './fixtures/api/createWebhook.created.json';
import invalidUrl from './fixtures/api/createWebhook.invalid-url.json';
import deleted from './fixtures/api/deleteWebhook.deleted.json';
import { hookContext, WEBHOOK_URL } from './helpers/hook-context';

const hooks = new KadmoTrigger().webhookMethods.default;
const SECRET = created.answer.secret;

function listed(entries: Array<Record<string, unknown>>) {
	return { statusCode: 200, body: { data: entries } };
}

function subscription(overrides: Record<string, unknown> = {}) {
	return {
		id: 7,
		url: WEBHOOK_URL,
		events: ['job.finished'],
		workspace: null,
		status: 'active',
		disabled_reason: null,
		...overrides,
	};
}

const notFound = { statusCode: 404, body: { error: 'No such webhook.', code: 'webhook_not_found' } };

describe('checkExists', () => {
	it('is false with nothing stored, without a call', async () => {
		const { context, calls } = hookContext({ answers: [] });
		expect(await hooks.checkExists.call(context)).toBe(false);
		expect(calls()).toHaveLength(0);
	});

	it('is true when the stored subscription is listed, active and the same', async () => {
		const { context, calls } = hookContext({
			answers: [listed([subscription()])],
			staticData: { webhookId: 7, webhookSecret: SECRET },
		});
		expect(await hooks.checkExists.call(context)).toBe(true);
		expect(calls()[0]).toMatchObject({ method: 'GET', url: '/webhooks' });
	});

	it('is false and forgets the data when the stored id is no longer listed', async () => {
		const { context, staticData } = hookContext({
			answers: [listed([])],
			staticData: { webhookId: 7, webhookSecret: SECRET },
		});
		expect(await hooks.checkExists.call(context)).toBe(false);
		expect(staticData).toEqual({});
	});

	it.each([
		['disabled', { status: 'disabled', disabled_reason: 'failing' }],
		['for other events', { events: ['job.finished', 'task.done'] }],
		['for another workspace', { workspace: { slug: 'web', name: 'Web' } }],
		['for another URL', { url: 'https://old.example.com/webhook/x' }],
	])('deletes a stored subscription that is %s and answers false', async (_case, overrides) => {
		const { context, staticData, calls } = hookContext({
			answers: [listed([subscription(overrides)]), { statusCode: 200, body: deleted.answer }],
			staticData: { webhookId: 7, webhookSecret: SECRET },
		});
		expect(await hooks.checkExists.call(context)).toBe(false);
		expect(calls()[1]).toMatchObject({ method: 'DELETE', url: '/webhooks/7' });
		expect(staticData).toEqual({});
	});

	it('matches a workspace by its slug', async () => {
		const { context } = hookContext({
			answers: [listed([subscription({ workspace: { slug: 'web', name: 'Web' } })])],
			staticData: { webhookId: 7, webhookSecret: SECRET },
			workspace: 'web',
		});
		expect(await hooks.checkExists.call(context)).toBe(true);
	});
});

describe('create', () => {
	it('deletes leftovers on this URL, subscribes and stores the id and the secret', async () => {
		const { context, staticData, calls } = hookContext({
			answers: [
				listed([subscription({ id: 3 }), subscription({ id: 4, url: 'https://other.example.com/hook' })]),
				{ statusCode: 200, body: { id: 3, deleted: true } },
				{ statusCode: 201, body: { ...created.answer, url: WEBHOOK_URL } },
			],
			events: ['job.finished', 'job.needs_input'],
			workspace: 'main',
		});
		expect(await hooks.create.call(context)).toBe(true);
		const [list, removal, post] = calls();
		expect(list).toMatchObject({ method: 'GET', url: '/webhooks' });
		expect(removal).toMatchObject({ method: 'DELETE', url: '/webhooks/3' });
		expect(post).toMatchObject({
			method: 'POST',
			url: '/webhooks',
			body: { url: WEBHOOK_URL, events: ['job.finished', 'job.needs_input'], workspace: 'main' },
		});
		expect(staticData).toEqual({ webhookId: created.answer.id, webhookSecret: SECRET });
	});

	it('sends no workspace when none is chosen', async () => {
		const { context, calls } = hookContext({
			answers: [listed([]), { statusCode: 201, body: created.answer }],
		});
		await hooks.create.call(context);
		expect(calls()[1].body).toEqual({ url: WEBHOOK_URL, events: ['job.finished'] });
	});

	it('puts the public https advice in the message of a refused URL', async () => {
		const { context } = hookContext({
			answers: [listed([]), { statusCode: 422, body: invalidUrl.answer }],
			url: 'http://localhost:5678/webhook/x/webhook',
		});
		const failure = await hooks.create.call(context).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(NodeApiError);
		expect((failure as NodeApiError).message).toContain(invalidUrl.answer.error);
		expect((failure as NodeApiError).message).toContain('N8N_WEBHOOK_URL');
	});
});

describe('delete', () => {
	it('deletes the stored subscription first, then any other on this URL, and clears the data', async () => {
		const { context, staticData, calls } = hookContext({
			answers: [
				{ statusCode: 200, body: { id: 7, deleted: true } },
				listed([subscription({ id: 9 }), subscription({ id: 10, url: 'https://other.example.com/hook' })]),
				{ statusCode: 200, body: { id: 9, deleted: true } },
			],
			staticData: { webhookId: 7, webhookSecret: SECRET },
		});
		expect(await hooks.delete.call(context)).toBe(true);
		expect(calls().map((call) => `${String(call.method)} ${String(call.url)}`)).toEqual([
			'DELETE /webhooks/7',
			'GET /webhooks',
			'DELETE /webhooks/9',
		]);
		expect(staticData).toEqual({});
	});

	it('has deleted the stored subscription even when the list call fails afterwards', async () => {
		const { context, staticData, calls } = hookContext({
			answers: [
				{ statusCode: 200, body: { id: 7, deleted: true } },
				{ statusCode: 500, body: { code: 'internal_error' } },
			],
			staticData: { webhookId: 7, webhookSecret: SECRET },
		});
		await expect(hooks.delete.call(context)).rejects.toBeInstanceOf(NodeApiError);
		expect(calls()[0]).toMatchObject({ method: 'DELETE', url: '/webhooks/7' });
		expect(staticData).toEqual({});
	});

	it('treats a subscription already gone as deleted', async () => {
		const { context, staticData } = hookContext({
			answers: [notFound, listed([])],
			staticData: { webhookId: 7, webhookSecret: SECRET },
		});
		expect(await hooks.delete.call(context)).toBe(true);
		expect(staticData).toEqual({});
	});

	it('throws a NodeApiError on a revoked token', async () => {
		const { context } = hookContext({
			answers: [{ statusCode: 401, body: { error: 'Unauthorized.', code: 'unauthorized' } }],
			staticData: { webhookId: 7, webhookSecret: SECRET },
		});
		await expect(hooks.delete.call(context)).rejects.toBeInstanceOf(NodeApiError);
	});
});

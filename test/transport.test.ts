import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeApiError, sleep } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	describeRefusal,
	kadmoApiError,
	refusalMessage,
	WEBHOOK_URL_ADVICE,
} from '../nodes/Kadmo/transport/errors';
import { buildIdempotencyKey, idempotencyKey } from '../nodes/Kadmo/transport/idempotency';
import { apiBaseUrl, kadmoRequest, MAX_WAITS, retryAfterMs } from '../nodes/Kadmo/transport/request';
import doc from './fixtures/openapi.v1.json';
import createTaskPartial from './fixtures/api/createTask.partial.json';
import createWebhookInvalidUrl from './fixtures/api/createWebhook.invalid-url.json';
import getJobRunning from './fixtures/api/getJob.running.json';
import runTaskActive from './fixtures/api/runTask.active.json';
import type { Reply } from './helpers/context';
import { executeContext, refusal, reply } from './helpers/context';

vi.mock('n8n-workflow', async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	sleep: vi.fn(async () => {}),
}));

const sleepMock = vi.mocked(sleep);

beforeEach(() => {
	sleepMock.mockClear();
});

/** Calls `kadmoRequest` and answers the error it throws. */
async function refusalOf(
	replies: Reply[],
	itemIndex?: number,
): Promise<NodeApiError> {
	const { ctx } = executeContext({ replies });
	const error = await kadmoRequest.call(ctx, { method: 'GET', path: '/me', itemIndex }).then(
		() => undefined,
		(thrown: unknown) => thrown,
	);
	expect(error).toBeInstanceOf(NodeApiError);
	return error as NodeApiError;
}

const rateLimited = { error: 'Too many calls. Wait a moment.', code: 'rate_limited' };
const ok = { statusCode: 200, headers: {}, body: { id: 1 } };

describe('apiBaseUrl', () => {
	it.each([
		['https://app.kadmo.ai', 'https://app.kadmo.ai/api/v1'],
		['https://app.kadmo.ai/', 'https://app.kadmo.ai/api/v1'],
		['https://app.kadmo.ai///', 'https://app.kadmo.ai/api/v1'],
		['https://app.kadmo.ai/api/v1', 'https://app.kadmo.ai/api/v1'],
		['https://app.kadmo.ai/api/v1/', 'https://app.kadmo.ai/api/v1'],
		['  https://kadmo.example.test/api/v1/  ', 'https://kadmo.example.test/api/v1'],
		['http://localhost:4321', 'http://localhost:4321/api/v1'],
	])('%j → %j', (input, expected) => {
		expect(apiBaseUrl(input)).toBe(expected);
	});

	it('sends the call to the API base with the path as url', async () => {
		const { ctx, http } = executeContext({
			replies: [ok],
			credentials: { apiToken: 'kadmo_api_example', baseUrl: 'https://app.kadmo.ai/api/v1/' },
		});
		const answer = await kadmoRequest.call(ctx, { method: 'GET', path: '/me' });
		expect(answer).toEqual({ status: 200, body: { id: 1 } });
		expect(http.credentialTypes).toEqual(['kadmoApi']);
		expect(http.calls[0]).toMatchObject({
			method: 'GET',
			baseURL: 'https://app.kadmo.ai/api/v1',
			url: '/me',
			json: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
			headers: { Accept: 'application/json' },
		});
		expect(http.calls[0]).not.toHaveProperty('body');
		expect(http.calls[0]).not.toHaveProperty('qs');
	});

	it('passes qs and body when given', async () => {
		const { ctx, http } = executeContext({ replies: [ok] });
		await kadmoRequest.call(ctx, { method: 'POST', path: '/x', qs: { a: 1 }, body: { b: 2 } });
		expect(http.calls[0]).toMatchObject({ qs: { a: 1 }, body: { b: 2 } });
	});

	it('answers {} for a 2xx without a body and parses a JSON body sent as text', async () => {
		const { ctx } = executeContext({
			replies: [
				{ statusCode: 204, body: undefined },
				{ statusCode: 200, body: JSON.stringify({ id: 9 }) },
			],
		});
		expect(await kadmoRequest.call(ctx, { method: 'DELETE', path: '/x' })).toEqual({ status: 204, body: {} });
		expect(await kadmoRequest.call(ctx, { method: 'GET', path: '/x' })).toEqual({ status: 200, body: { id: 9 } });
	});
});

describe('retryAfterMs', () => {
	it.each([
		[{ 'retry-after': '2' }, 2000],
		[{ 'Retry-After': '5' }, 5000],
		[{ 'retry-after': '0' }, 1000],
		[{ 'retry-after': '20' }, 20000],
		[{ 'retry-after': '21' }, undefined],
		[{ 'retry-after': 'soon' }, 1000],
		[{}, 1000],
		[undefined, 1000],
	])('%j → %j', (headers, expected) => {
		expect(retryAfterMs(headers)).toBe(expected);
	});
});

describe('waiting out 429 and 409', () => {
	it('waits out a 429 rate_limited by its Retry-After and retries', async () => {
		const { ctx, http } = executeContext({
			replies: [refusal(429, rateLimited, { 'retry-after': '2' }), ok],
		});
		const answer = await kadmoRequest.call(ctx, { method: 'GET', path: '/me' });
		expect(answer.body).toEqual({ id: 1 });
		expect(http.fn).toHaveBeenCalledTimes(2);
		expect(sleepMock).toHaveBeenCalledTimes(1);
		expect(sleepMock).toHaveBeenCalledWith(2000);
	});

	it(`waits ${MAX_WAITS} times at most, then throws the refusal`, async () => {
		expect(MAX_WAITS).toBe(3);
		const replies = Array.from({ length: 5 }, () => refusal(429, rateLimited, { 'retry-after': '1' }));
		const { ctx, http } = executeContext({ replies });
		const error = await kadmoRequest.call(ctx, { method: 'GET', path: '/me' }).then(
			() => undefined,
			(thrown: unknown) => thrown as NodeApiError,
		);
		expect(error).toBeInstanceOf(NodeApiError);
		expect(error?.message).toBe(rateLimited.error);
		expect(error?.httpCode).toBe('429');
		expect(error?.description).toContain('120 calls a minute');
		expect(http.fn).toHaveBeenCalledTimes(4);
		expect(sleepMock).toHaveBeenCalledTimes(3);
	});

	it('waits out a 409 idempotency_in_progress', async () => {
		const { ctx, http } = executeContext({
			replies: [
				refusal(409, { error: 'The same request is still running.', code: 'idempotency_in_progress' }),
				{ statusCode: 201, body: { id: 2 } },
			],
		});
		const answer = await kadmoRequest.call(ctx, { method: 'POST', path: '/jobs', body: {} });
		expect(answer).toEqual({ status: 201, body: { id: 2 } });
		expect(http.fn).toHaveBeenCalledTimes(2);
		expect(sleepMock).toHaveBeenCalledWith(1000);
	});

	it('does not retry a 429 daily_cap_reached', async () => {
		const error = await refusalOf([
			refusal(429, { error: 'The daily cap is reached.', code: 'daily_cap_reached' }, { 'retry-after': '1' }),
			ok,
		]);
		expect(sleepMock).not.toHaveBeenCalled();
		expect(error.message).toBe('The daily cap is reached.');
		expect(error.httpCode).toBe('429');
		expect(error.description).toBe('The account reached its daily usage cap. It resets at midnight UTC.');
	});

	it('does not wait a Retry-After over 20 seconds', async () => {
		const { ctx, http } = executeContext({ replies: [refusal(429, rateLimited, { 'retry-after': '60' }), ok] });
		await expect(kadmoRequest.call(ctx, { method: 'GET', path: '/me' })).rejects.toBeInstanceOf(NodeApiError);
		expect(http.fn).toHaveBeenCalledTimes(1);
		expect(sleepMock).not.toHaveBeenCalled();
	});

	it('does not retry a plain 409 refusal', async () => {
		const error = await refusalOf([
			refusal(409, { error: 'Already queued.', code: 'duplicate_job' }, { 'retry-after': '1' }),
			ok,
		]);
		expect(sleepMock).not.toHaveBeenCalled();
		expect(error.httpCode).toBe('409');
	});
});

describe('refusals', () => {
	const codes = (doc.components.schemas.Error.properties.code.enum as string[]).filter(
		(code) => code !== 'invalid_webhook_url',
	);
	const statusFor = (code: string): number =>
		code === 'unauthorized'
			? 401
			: code.endsWith('_not_found') || code === 'not_found'
				? 404
				: code === 'rate_limited' || code === 'daily_cap_reached'
					? 429
					: code.endsWith('_error') || code.endsWith('_unavailable')
						? 502
						: 409;

	it.each(codes)('%s → NodeApiError with Kadmo’s sentence, the advice and the HTTP status', async (code) => {
		const status = statusFor(code);
		const body = { error: `Kadmo refused: ${code}.`, code };
		// The two waited codes are answered until the waits run out.
		const error = await refusalOf(
			Array.from({ length: MAX_WAITS + 1 }, () => refusal(status, body)),
			3,
		);
		expect(error.message).toBe(`Kadmo refused: ${code}. [item 3]`);
		expect(error.description).toBe(describeRefusal(status, body));
		expect(error.description).toBeTruthy();
		expect(error.httpCode).toBe(String(status));
		expect(error.httpCode).not.toBe(code);
		expect(error.context.itemIndex).toBe(3);
	});

	it('has no item suffix without an item index', async () => {
		const error = await refusalOf([refusal(404, { error: 'No such job.', code: 'job_not_found' })]);
		expect(error.message).toBe('No such job.');
		expect(error.description).toBe('Check the Job ID: it is the id the Dispatch operation answered.');
		expect(error.httpCode).toBe('404');
	});

	it.each([
		[401, 'unauthorized', 'Check the API token in the credential'],
		[402, 'no_credit', 'Add credit to the Kadmo account under Settings › Billing'],
		[404, 'workspace_not_found', 'Check the Workspace parameter'],
		[404, 'not_found', 'The Base URL in the credential does not serve Kadmo’s API'],
		[409, 'idempotency_key_reused', 'A request with this Idempotency Key was sent before with other values'],
		[413, 'payload_too_large', 'The request is over 512 KB'],
		[500, 'internal_error', 'Kadmo could not complete the call'],
	])('%i %s → the table’s line', async (status, code, line) => {
		const error = await refusalOf([refusal(status, { error: 'Refused.', code })]);
		expect(error.description?.startsWith(line)).toBe(true);
	});

	it('invalid_request lists its details', async () => {
		const body = {
			error: 'The request is not valid.',
			code: 'invalid_request',
			details: [
				{ path: 'title', message: 'Required' },
				{ path: ['input', 'ticket_url'], message: 'Too long' },
			],
		};
		const error = await refusalOf([refusal(400, body)], 0);
		expect(error.message).toBe('The request is not valid. [item 0]');
		expect(error.description).toBe(
			'Kadmo says: title: Required; input.ticket_url: Too long. Check the parameters named above.',
		);
		expect(error.httpCode).toBe('400');
	});

	it('invalid_request with details as an object of fields', () => {
		expect(
			describeRefusal(400, { code: 'invalid_request', details: { title: ['Required', 'Too short'], effort: 'Bad' } }),
		).toBe('Kadmo says: title: Required, Too short; effort: Bad. Check the parameters named above.');
	});

	it('invalid_issue_type lists the types', async () => {
		const error = await refusalOf([
			refusal(422, { error: 'Unknown type.', code: 'invalid_issue_type', issue_types: ['Bug', 'Story'] }),
		]);
		expect(error.description).toBe(
			'The account files these types: Bug, Story. Set the Type option to one of the types listed above.',
		);
		expect(error.httpCode).toBe('422');
	});

	it('tracker_error names the ticket that was filed (createTask.partial)', async () => {
		const error = await refusalOf([reply(createTaskPartial)], 1);
		expect(error.message).toBe(`${createTaskPartial.answer.error} [item 1]`);
		expect(error.description).toBe(
			'The ticket MA-1 was filed. The tracker refused or did not answer. Running the node again in this execution answers the same result.',
		);
		expect(error.httpCode).toBe('502');
	});

	it('run_active links the run (runTask.active)', async () => {
		const error = await refusalOf([reply(runTaskActive)]);
		expect(error.message).toBe(runTaskActive.answer.error);
		expect(error.description).toBe(
			`The run: ${runTaskActive.answer.run.url} A run already drives this task. Nothing new was started: follow that run, or wait until it ends.`,
		);
		expect(error.httpCode).toBe('409');
	});

	it('invalid_webhook_url carries the N8N_WEBHOOK_URL advice in the message (createWebhook.invalid-url)', async () => {
		const error = await refusalOf([reply(createWebhookInvalidUrl)]);
		expect(error.message).toBe(`${createWebhookInvalidUrl.answer.error} ${WEBHOOK_URL_ADVICE}`);
		expect(error.message).toContain('N8N_WEBHOOK_URL');
		expect(error.httpCode).toBe('422');
	});

	it('a non-JSON (HTML) body says what was answered', async () => {
		const error = await refusalOf([
			{ statusCode: 502, headers: { 'content-type': 'text/html' }, body: '<html><body>Bad gateway</body></html>' },
		]);
		expect(error.message).toBe('Kadmo answered 502');
		expect(error.description).toBe('Kadmo could not complete the call. Run the node again in a few minutes.');
		expect(error.httpCode).toBe('502');
	});

	it('a 404 that is not Kadmo\'s points at the Base URL', async () => {
		const error = await refusalOf([{ statusCode: 404, body: '<html>Not Found</html>' }], 2);
		expect(error.message).toBe('Kadmo answered 404 [item 2]');
		expect(error.description).toContain('The Base URL in the credential does not serve Kadmo’s API');
		expect(error.httpCode).toBe('404');
	});

	it('an empty or array body still makes a NodeApiError', () => {
		const node = executeContext().node;
		for (const body of [undefined, null, [], 'text']) {
			const error = kadmoApiError(node, 503, body);
			expect(error).toBeInstanceOf(NodeApiError);
			expect(error.message).toBe('Kadmo answered 503');
			expect(error.httpCode).toBe('503');
		}
	});

	it('refusalMessage falls back to the status and code when the sentence is blank', () => {
		expect(refusalMessage(400, { error: '   ', code: 'invalid_request' })).toBe('Kadmo answered 400 (invalid_request)');
		expect(refusalMessage(400, { error: '  Trimmed.  ' })).toBe('Trimmed.');
	});

	it('an unknown code gets the generic line', () => {
		expect(describeRefusal(418, { code: 'teapot' })).toBe('Kadmo answered 418 (teapot).');
		expect(describeRefusal(503, { code: 'teapot' })).toBe(
			'Kadmo could not complete the call. Run the node again in a few minutes.',
		);
	});
});

describe('idempotency keys', () => {
	it('buildIdempotencyKey has the shape n8n-<exec>-<node>-<run>-<item>', () => {
		expect(buildIdempotencyKey({ executionId: '42', nodeId: 'node-uuid', runIndex: 1, itemIndex: 3 })).toBe(
			'n8n-42-node-uuid-1-3',
		);
	});

	function keyFor(options: Parameters<typeof executeContext>[0], item: number, override = ''): string {
		const { ctx } = executeContext(options);
		return idempotencyKey.call(ctx as IExecuteFunctions, item, override);
	}

	it('is the same on a repeat and differs across items, runs and executions', () => {
		const first = keyFor({}, 0);
		expect(first).toBe('n8n-exec-1-node-uuid-0-0');
		expect(keyFor({}, 0)).toBe(first);
		expect(keyFor({}, 1)).toBe('n8n-exec-1-node-uuid-0-1');
		expect(keyFor({ runIndex: 2 }, 0)).toBe('n8n-exec-1-node-uuid-2-0');
		expect(keyFor({ executionId: 'exec-2' }, 0)).toBe('n8n-exec-2-node-uuid-0-0');
	});

	it('uses "manual" without an execution id', () => {
		expect(keyFor({ executionId: undefined }, 0)).toBe('n8n-manual-node-uuid-0-0');
	});

	it('the override wins, trimmed', () => {
		expect(keyFor({}, 4, '  my-own-key  ')).toBe('my-own-key');
		expect(keyFor({}, 4, '   ')).toBe('n8n-exec-1-node-uuid-0-4');
	});

	it('is visible ASCII within 255 characters', () => {
		const key = keyFor({ executionId: '123456789' }, 99);
		expect(key).toMatch(/^[\x21-\x7e]{1,255}$/);
	});
});

it('getJob.running fixture answers through the transport unchanged', async () => {
	const { ctx } = executeContext({ replies: [reply(getJobRunning)] });
	const answer = await kadmoRequest.call(ctx, { method: 'GET', path: '/jobs/4' });
	expect(answer.body).toEqual(getJobRunning.answer);
});

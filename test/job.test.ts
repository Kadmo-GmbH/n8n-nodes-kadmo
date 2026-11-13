import type { IDataObject, INodeExecutionData } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { dispatchBody, Kadmo } from '../nodes/Kadmo/Kadmo.node';
import { SIMPLE_JOB_FIELDS } from '../nodes/Kadmo/helpers/simplify';
import createJobDuplicate from './fixtures/api/createJob.duplicate.json';
import createJobQueued from './fixtures/api/createJob.queued.json';
import getJobNeedsInput from './fixtures/api/getJob.needs-input.json';
import getJobRunning from './fixtures/api/getJob.running.json';
import getJobSucceeded from './fixtures/api/getJob.succeeded.json';
import type { ContextOptions } from './helpers/context';
import { autoKey, executeContext, locator, reply, TOOL_NODE_TYPE } from './helpers/context';

vi.mock('n8n-workflow', async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	sleep: vi.fn(async () => {}),
}));

const BASE_URL = 'https://app.kadmo.ai/api/v1';

const dispatchParams: IDataObject = {
	resource: 'job',
	operation: 'dispatch',
	workspace: locator('main'),
	workflow: locator('se-work'),
	inputs: {
		mappingMode: 'defineBelow',
		value: { ticket_url: 'https://example.atlassian.net/browse/PROJ-123', hint: '', depth: null },
	},
	additionalFields: {},
	simplify: true,
};

function getParams(jobId: string, extra: IDataObject = {}): IDataObject {
	return { resource: 'job', operation: 'get', jobId, simplify: true, ...extra };
}

async function run(options: ContextOptions) {
	const context = executeContext(options);
	const output = await new Kadmo().execute.call(context.ctx);
	return { ...context, output, items: output[0] };
}

async function failure(options: ContextOptions): Promise<{ error: Error; calls: number }> {
	const context = executeContext(options);
	const error = await new Kadmo().execute.call(context.ctx).then(
		() => undefined,
		(thrown: unknown) => thrown as Error,
	);
	expect(error).toBeDefined();
	return { error: error as Error, calls: context.http.fn.mock.calls.length };
}

function expectPaired(items: INodeExecutionData[]) {
	items.forEach((item, i) => expect(item.pairedItem).toEqual({ item: i }));
}

function expectFlat(json: IDataObject) {
	expect(Object.keys(json).length).toBeLessThanOrEqual(10);
	for (const value of Object.values(json)) {
		const nested = value !== null && typeof value === 'object' && !Array.isArray(value);
		expect(nested).toBe(false);
	}
}

describe('Job › Dispatch', () => {
	it('POSTs /jobs with the mapped inputs and an Idempotency-Key', async () => {
		const { http, items } = await run({ params: dispatchParams, replies: [reply(createJobQueued)] });
		expect(http.calls).toHaveLength(1);
		const call = http.calls[0];
		expect(call.method).toBe('POST');
		expect(call.baseURL).toBe(BASE_URL);
		expect(call.url).toBe('/jobs');
		expect(call.body).toEqual(createJobQueued.request);
		expect(call.headers).toEqual({ Accept: 'application/json', 'Idempotency-Key': autoKey() });
		expect(items).toHaveLength(1);
		expectPaired(items);
	});

	it('Simplify on: at most ten flat fields', async () => {
		const { items } = await run({ params: dispatchParams, replies: [reply(createJobQueued)] });
		expect(items[0].json).toEqual({
			id: 1,
			status: 'queued',
			workflow: 'se-work',
			task: 'PROJ-123',
			url: 'http://localhost/jobs?status=queued',
			question: null,
			verdict: null,
			summary: null,
			pull_requests: [],
			error: null,
		});
		expect(Object.keys(items[0].json)).toEqual([...SIMPLE_JOB_FIELDS]);
		expectFlat(items[0].json);
	});

	it('Simplify off: the raw answer', async () => {
		const { items } = await run({
			params: { ...dispatchParams, simplify: false },
			replies: [reply(createJobQueued)],
		});
		expect(items[0].json).toEqual(createJobQueued.answer);
	});

	it('leaves out empty values of the mapper and of Extra Inputs, and merges Extra Inputs, effort and the own key', async () => {
		const { http } = await run({
			params: {
				...dispatchParams,
				inputs: {
					mappingMode: 'defineBelow',
					value: { ticket_url: 'u', hint: '', depth: null, gone: undefined, count: 3, flags: { a: true } },
				},
				additionalFields: {
					effort: ' high ',
					idempotencyKey: ' own-key ',
					extraInputs: {
						input: [
							{ name: ' hint ', value: 'Look at the cookie.' },
							{ name: '   ', value: 'ignored' },
							{ name: 'ticket_url', value: 'override' },
							{ name: 'blank' },
						],
					},
				},
			},
			replies: [reply(createJobQueued)],
		});
		expect(http.calls[0].body).toEqual({
			workflow: 'se-work',
			workspace: 'main',
			input: {
				ticket_url: 'override',
				count: '3',
				flags: '{"a":true}',
				hint: 'Look at the cookie.',
			},
			effort: 'high',
		});
		expect(http.calls[0].headers).toMatchObject({ 'Idempotency-Key': 'own-key' });
	});

	it('sends no input when the mapper is empty', async () => {
		const { http } = await run({
			params: { ...dispatchParams, inputs: { mappingMode: 'defineBelow', value: null } },
			replies: [reply(createJobQueued)],
		});
		expect(http.calls[0].body).toEqual({ workflow: 'se-work', workspace: 'main' });
	});

	it('takes a workspace and workflow typed by slug or name', async () => {
		const { http } = await run({
			params: { ...dispatchParams, workspace: locator(' main ', 'slug'), workflow: locator('se-work ', 'name') },
			replies: [reply(createJobQueued)],
		});
		expect(http.calls[0].body).toMatchObject({ workflow: 'se-work', workspace: 'main' });
	});

	it('gives each item and each run its own key', async () => {
		const first = await run({
			params: [dispatchParams, dispatchParams],
			items: [{ json: {} }, { json: {} }],
			replies: [reply(createJobQueued), reply(createJobQueued)],
		});
		expect(first.http.calls.map((call) => call.headers?.['Idempotency-Key'])).toEqual([
			autoKey(0),
			autoKey(1),
		]);
		expectPaired(first.items);
		const loop = await run({ params: dispatchParams, runIndex: 2, replies: [reply(createJobQueued)] });
		expect(loop.http.calls[0].headers?.['Idempotency-Key']).toBe(autoKey(0, 2));
	});

	it('a 409 duplicate_job throws Kadmo’s refusal', async () => {
		const { error, calls } = await failure({ params: dispatchParams, replies: [reply(createJobDuplicate)] });
		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toBe(`${createJobDuplicate.answer.error} [item 0]`);
		expect((error as NodeApiError).httpCode).toBe('409');
		expect((error as NodeApiError).description).toBe(
			'The same workflow is already queued or running for this task. Nothing new was started.',
		);
		expect(calls).toBe(1);
	});

	it('Continue On Fail returns the refusal as an item and goes on', async () => {
		const { items } = await run({
			params: [dispatchParams, dispatchParams],
			items: [{ json: {} }, { json: {} }],
			continueOnFail: true,
			replies: [reply(createJobDuplicate), reply(createJobQueued)],
		});
		expect(items).toHaveLength(2);
		expect(items[0].json).toEqual({
			error: `${createJobDuplicate.answer.error} [item 0]`,
			description: 'The same workflow is already queued or running for this task. Nothing new was started.',
		});
		expect(items[1].json).toMatchObject({ id: 1, status: 'queued' });
		expectPaired(items);
	});
});

describe('Job › Get', () => {
	it('GETs /jobs/{id} with no body and no Idempotency-Key', async () => {
		const { http, items } = await run({ params: getParams(' 4 '), replies: [reply(getJobRunning)] });
		const call = http.calls[0];
		expect(call.method).toBe('GET');
		expect(call.baseURL).toBe(BASE_URL);
		expect(call.url).toBe('/jobs/4');
		expect(call).not.toHaveProperty('body');
		expect(call.headers).toEqual({ Accept: 'application/json' });
		expect(items[0].json).toEqual({
			id: 4,
			status: 'running',
			workflow: 'se-work',
			task: 'PROJ-123',
			url: 'http://localhost/jobs/1',
			question: null,
			verdict: null,
			summary: null,
			pull_requests: [],
			error: null,
		});
		expectPaired(items);
	});

	it('a job waiting for input shows its question', async () => {
		const { items } = await run({ params: getParams('1'), replies: [reply(getJobNeedsInput)] });
		expect(items[0].json).toMatchObject({
			id: 1,
			status: 'needs_input',
			question: 'Which branch should the fix target?',
		});
		expectFlat(items[0].json);
	});

	it('a finished job shows its verdict, summary and pull requests', async () => {
		const { items } = await run({ params: getParams('4'), replies: [reply(getJobSucceeded)] });
		expect(items[0].json).toMatchObject({
			status: 'succeeded',
			verdict: 'PASS',
			summary: 'Fixed it.',
			pull_requests: getJobSucceeded.answer.result.pull_requests,
		});
		expectFlat(items[0].json);
	});

	it.each([getJobRunning, getJobNeedsInput, getJobSucceeded])('Simplify off answers $answer.status raw', async (fixture) => {
		const { items } = await run({ params: getParams('4', { simplify: false }), replies: [reply(fixture)] });
		expect(items[0].json).toEqual(fixture.answer);
	});

	it.each(['abc', '4a', '-1', '1.5', '', '../me'])('rejects the Job ID %j without calling Kadmo', async (jobId) => {
		const { error, calls } = await failure({ params: getParams(jobId), replies: [reply(getJobRunning)] });
		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.message).toContain('The Job ID must be a number');
		expect(error.message).toContain('[item 0]');
		expect(calls).toBe(0);
	});

	it('Continue On Fail turns a bad Job ID into an item', async () => {
		const { items, http } = await run({ params: getParams('x'), continueOnFail: true });
		expect(http.fn).not.toHaveBeenCalled();
		expect(items[0].json).toEqual({
			error: 'The Job ID must be a number, not "x" [item 0]',
			description: 'Use the id the Dispatch operation answered.',
		});
		expect(items[0].pairedItem).toEqual({ item: 0 });
	});
});

describe('Job › AI tool variant', () => {
	it('Output raw answers the job as Kadmo does', async () => {
		const { items } = await run({
			nodeType: TOOL_NODE_TYPE,
			params: getParams('4', { output: 'raw', simplify: true }),
			replies: [reply(getJobSucceeded)],
		});
		expect(items[0].json).toEqual(getJobSucceeded.answer);
	});

	it('Output simplified (the default) ignores Simplify', async () => {
		const { items } = await run({
			nodeType: TOOL_NODE_TYPE,
			params: getParams('4', { simplify: false }),
			replies: [reply(getJobSucceeded)],
		});
		expect(Object.keys(items[0].json)).toEqual([...SIMPLE_JOB_FIELDS]);
		expect(items[0].json.verdict).toBe('PASS');
	});

	it('Output selected keeps the id and the fields asked for', async () => {
		const { items } = await run({
			nodeType: TOOL_NODE_TYPE,
			params: getParams('4', { output: 'selected', fields: ' status, result ,nope,, ' }),
			replies: [reply(getJobSucceeded)],
		});
		expect(items[0].json).toEqual({
			id: 4,
			status: 'succeeded',
			result: getJobSucceeded.answer.result,
		});
		expectPaired(items);
	});
});

describe('unknown operation', () => {
	it('throws a NodeOperationError without calling Kadmo', async () => {
		const { error, calls } = await failure({ params: { resource: 'job', operation: 'delete' } });
		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.message).toBe('The operation "delete" is not known [item 0]');
		expect(calls).toBe(0);
	});
});

describe('dispatchBody', () => {
	it('builds the recorded request', () => {
		expect(
			dispatchBody('main', 'se-work', { ticket_url: 'https://example.atlassian.net/browse/PROJ-123' }, {}),
		).toEqual(createJobQueued.request);
	});

	it('leaves out a blank effort and no Extra Inputs', () => {
		expect(dispatchBody(' main ', ' w ', null, { effort: '  ', extraInputs: {} })).toEqual({
			workflow: 'w',
			workspace: 'main',
		});
	});
});

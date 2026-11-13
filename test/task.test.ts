import type { IDataObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { createTaskBody, Kadmo, runPlaybookBody } from '../nodes/Kadmo/Kadmo.node';
import { SIMPLE_TASK_FIELDS, simplifyTask } from '../nodes/Kadmo/helpers/simplify';
import createTaskInternal from './fixtures/api/createTask.internal.json';
import createTaskPartial from './fixtures/api/createTask.partial.json';
import getTaskPending from './fixtures/api/getTask.pending.json';
import runTaskActive from './fixtures/api/runTask.active.json';
import runTaskStarted from './fixtures/api/runTask.started.json';
import runTaskWaiting from './fixtures/api/runTask.waiting.json';
import type { ContextOptions } from './helpers/context';
import { autoKey, executeContext, locator, reply, TOOL_NODE_TYPE } from './helpers/context';

vi.mock('n8n-workflow', async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	sleep: vi.fn(async () => {}),
}));

const BASE_URL = 'https://app.kadmo.ai/api/v1';

const createParams: IDataObject = {
	resource: 'task',
	operation: 'create',
	workspace: locator('main'),
	title: 'Fix the login',
	additionalFields: { description: 'It loops.', priority: 'high' },
	simplify: true,
};

function getParams(taskKey: string, extra: IDataObject = {}): IDataObject {
	return { resource: 'task', operation: 'get', taskKey, simplify: true, ...extra };
}

function runParams(runOptions: IDataObject, extra: IDataObject = {}): IDataObject {
	return {
		resource: 'task',
		operation: 'runPlaybook',
		taskKey: 'MA-1',
		playbook: locator('bug-fix'),
		runOptions,
		simplify: true,
		...extra,
	};
}

async function run(options: ContextOptions) {
	const context = executeContext(options);
	const output = await new Kadmo().execute.call(context.ctx);
	const items = output[0];
	items.forEach((item, i) => expect(item.pairedItem).toEqual({ item: i }));
	return { ...context, items };
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

const simplifiedCreated = {
	key: 'MA-1',
	title: 'Fix the login',
	status: 'pending',
	type: 'Task',
	tracker: 'internal',
	workspace: 'main',
	priority: 'high',
	playbook: null,
	run_status: null,
	url: 'http://localhost/tasks/MA-1',
};

describe('Task › Create', () => {
	it('POSTs /tasks with the options set and an Idempotency-Key', async () => {
		const { http, items } = await run({ params: createParams, replies: [reply(createTaskInternal)] });
		const call = http.calls[0];
		expect(call.method).toBe('POST');
		expect(call.baseURL).toBe(BASE_URL);
		expect(call.url).toBe('/tasks');
		expect(call.body).toEqual(createTaskInternal.request);
		expect(call.headers).toEqual({ Accept: 'application/json', 'Idempotency-Key': autoKey() });
		expect(items[0].json).toEqual(simplifiedCreated);
		expect(Object.keys(items[0].json)).toEqual([...SIMPLE_TASK_FIELDS]);
	});

	it('Simplify off: the raw answer', async () => {
		const { items } = await run({
			params: { ...createParams, simplify: false },
			replies: [reply(createTaskInternal)],
		});
		expect(items[0].json).toEqual(createTaskInternal.answer);
	});

	it('sends type and tracker, and the own key', async () => {
		const { http } = await run({
			params: {
				...createParams,
				title: '  Fix the login ',
				additionalFields: { type: ' Bug ', tracker: 'internal', description: '', idempotencyKey: 'mine' },
			},
			replies: [reply(createTaskInternal)],
		});
		expect(http.calls[0].body).toEqual({ workspace: 'main', title: 'Fix the login', type: 'Bug', tracker: 'internal' });
		expect(http.calls[0].headers).toMatchObject({ 'Idempotency-Key': 'mine' });
	});

	it('a 502 tracker_error after filing throws with the ticket key (createTask.partial)', async () => {
		const { error } = await failure({
			params: { ...createParams, title: 'Half', additionalFields: {} },
			replies: [reply(createTaskPartial)],
		});
		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toBe('The tracker refused or failed: pool read timed out [item 0]');
		expect((error as NodeApiError).httpCode).toBe('502');
		expect((error as NodeApiError).description).toContain('The ticket MA-1 was filed.');
	});

	it('Continue On Fail returns the refusal as an item', async () => {
		const { items, http } = await run({
			params: { ...createParams, title: 'Half', additionalFields: {} },
			continueOnFail: true,
			replies: [reply(createTaskPartial)],
		});
		expect(http.calls[0].body).toEqual(createTaskPartial.request);
		expect(items[0].json).toEqual({
			error: 'The tracker refused or failed: pool read timed out [item 0]',
			description:
				'The ticket MA-1 was filed. The tracker refused or did not answer. Running the node again in this execution answers the same result.',
		});
	});
});

describe('Task › Get', () => {
	it('GETs /tasks/{key} with no body and no Idempotency-Key', async () => {
		const { http, items } = await run({ params: getParams(' MA-1 '), replies: [reply(getTaskPending)] });
		const call = http.calls[0];
		expect(call.method).toBe('GET');
		expect(call.baseURL).toBe(BASE_URL);
		expect(call.url).toBe('/tasks/MA-1');
		expect(call).not.toHaveProperty('body');
		expect(call.headers).toEqual({ Accept: 'application/json' });
		expect(items[0].json).toEqual({
			key: 'MA-1',
			title: 'Read me',
			status: 'pending',
			type: 'Task',
			tracker: 'internal',
			workspace: 'main',
			priority: null,
			playbook: null,
			run_status: null,
			url: 'http://localhost/tasks/MA-1',
		});
	});

	it('Simplify off: the raw answer', async () => {
		const { items } = await run({ params: getParams('MA-1', { simplify: false }), replies: [reply(getTaskPending)] });
		expect(items[0].json).toEqual(getTaskPending.answer);
	});

	it('accepts keys with dots and underscores', async () => {
		const { http } = await run({ params: getParams('acme_web.PROJ-12'), replies: [reply(getTaskPending)] });
		expect(http.calls[0].url).toBe('/tasks/acme_web.PROJ-12');
	});

	it.each(['', 'MA 1', '../me', 'a/b', '-MA-1', 'MA-1?x=1', 'x'.repeat(101)])(
		'rejects the task key %j without calling Kadmo',
		async (taskKey) => {
			const { error, calls } = await failure({ params: getParams(taskKey), replies: [reply(getTaskPending)] });
			expect(error).toBeInstanceOf(NodeOperationError);
			expect(error.message).toContain('is not a task key [item 0]');
			expect(calls).toBe(0);
		},
	);
});

describe('Task › Run Playbook', () => {
	it('POSTs /tasks/{key}/runs and answers 201 with the task shaped', async () => {
		const { http, items } = await run({
			params: runParams({ effort: 'high', hint: 'Look at the cookie.' }),
			replies: [reply(runTaskStarted)],
		});
		const call = http.calls[0];
		expect(call.method).toBe('POST');
		expect(call.baseURL).toBe(BASE_URL);
		expect(call.url).toBe('/tasks/MA-1/runs');
		expect(call.body).toEqual(runTaskStarted.request);
		expect(call.headers).toEqual({ Accept: 'application/json', 'Idempotency-Key': autoKey() });
		expect(items[0].json).toEqual({
			task: simplifyTask(runTaskStarted.answer.task),
			run: runTaskStarted.answer.run,
			waiting_on: null,
		});
		expect((items[0].json.task as IDataObject).run_status).toBe('running');
		expect((items[0].json.task as IDataObject).playbook).toBe('bug-fix');
	});

	it('a 202 waiting answer has run null and says what it waits on', async () => {
		const { http, items } = await run({
			params: runParams({ workspace: ' full ' }),
			replies: [reply(runTaskWaiting)],
		});
		expect(http.calls[0].body).toEqual(runTaskWaiting.request);
		expect(items[0].json).toEqual({
			task: simplifyTask(runTaskWaiting.answer.task),
			run: null,
			waiting_on: { reason: 'pool_full', blockers: [], message: null },
		});
		expect((items[0].json.task as IDataObject).status).toBe('waiting');
	});

	it('Simplify off: the raw answer', async () => {
		const { items } = await run({
			params: runParams({ effort: 'high' }, { simplify: false }),
			replies: [reply(runTaskStarted)],
		});
		expect(items[0].json).toEqual(runTaskStarted.answer);
	});

	it('sends sync_status and validate as set, false included', async () => {
		const { http } = await run({
			params: runParams({ syncStatus: false, validate: true, hint: '', effort: '' }),
			replies: [reply(runTaskStarted)],
		});
		expect(http.calls[0].body).toEqual({ playbook: 'bug-fix', sync_status: false, validate: true });
	});

	it('a 409 run_active throws with the run’s link', async () => {
		const { error, calls } = await failure({
			params: runParams({ hint: 'again' }),
			replies: [reply(runTaskActive)],
		});
		expect(calls).toBe(1);
		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toBe(`${runTaskActive.answer.error} [item 0]`);
		expect((error as NodeApiError).httpCode).toBe('409');
		expect((error as NodeApiError).description).toContain('The run: http://localhost/playbooks/runs/2');
	});

	it('records the request run_active answered', async () => {
		const { http } = await run({
			params: runParams({ hint: 'again' }),
			continueOnFail: true,
			replies: [reply(runTaskActive)],
		});
		expect(http.calls[0].body).toEqual(runTaskActive.request);
	});

	it('rejects a bad task key before calling Kadmo', async () => {
		const { error, calls } = await failure({ params: runParams({}, { taskKey: 'MA 1' }) });
		expect(error).toBeInstanceOf(NodeOperationError);
		expect(calls).toBe(0);
	});
});

describe('Task › AI tool variant', () => {
	it('Output raw', async () => {
		const { items } = await run({
			nodeType: TOOL_NODE_TYPE,
			params: getParams('MA-1', { output: 'raw' }),
			replies: [reply(getTaskPending)],
		});
		expect(items[0].json).toEqual(getTaskPending.answer);
	});

	it('Output simplified', async () => {
		const { items } = await run({
			nodeType: TOOL_NODE_TYPE,
			params: getParams('MA-1', { output: 'simplified', simplify: false }),
			replies: [reply(getTaskPending)],
		});
		expect(items[0].json).toEqual(simplifyTask(getTaskPending.answer));
	});

	it('Output selected keeps the key and the fields asked for', async () => {
		const { items } = await run({
			nodeType: TOOL_NODE_TYPE,
			params: getParams('MA-1', { output: 'selected', fields: 'title,workspace, missing' }),
			replies: [reply(getTaskPending)],
		});
		expect(items[0].json).toEqual({ key: 'MA-1', title: 'Read me', workspace: { slug: 'main', name: 'Main' } });
	});

	it('Output selected on a run shapes only its task', async () => {
		const { items } = await run({
			nodeType: TOOL_NODE_TYPE,
			params: runParams({}, { output: 'selected', fields: 'status' }),
			replies: [reply(runTaskStarted)],
		});
		expect(items[0].json).toEqual({
			task: { key: 'MA-1', status: 'running' },
			run: runTaskStarted.answer.run,
			waiting_on: null,
		});
	});
});

describe('createTaskBody / runPlaybookBody', () => {
	it('createTaskBody builds the recorded request', () => {
		expect(createTaskBody('main', 'Fix the login', { description: 'It loops.', priority: 'high' })).toEqual(
			createTaskInternal.request,
		);
		expect(createTaskBody('main', 'Half', {})).toEqual(createTaskPartial.request);
	});

	it('runPlaybookBody builds the recorded requests', () => {
		expect(runPlaybookBody('bug-fix', { effort: 'high', hint: 'Look at the cookie.' })).toEqual(runTaskStarted.request);
		expect(runPlaybookBody('bug-fix', { workspace: 'full' })).toEqual(runTaskWaiting.request);
		expect(runPlaybookBody(' bug-fix ', { hint: 'again' })).toEqual(runTaskActive.request);
	});
});

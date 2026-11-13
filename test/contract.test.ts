import Ajv2020 from 'ajv/dist/2020';
import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { createTaskBody, dispatchBody, Kadmo, runPlaybookBody } from '../nodes/Kadmo/Kadmo.node';
import { searchPlaybooks, searchWorkflows, searchWorkspaces } from '../nodes/Kadmo/methods/listSearch';
import { getWorkflowInputs } from '../nodes/Kadmo/methods/resourceMapping';
import { kadmoRequest } from '../nodes/Kadmo/transport/request';
import createJobDuplicate from './fixtures/api/createJob.duplicate.json';
import createTaskPartial from './fixtures/api/createTask.partial.json';
import createWebhookInvalidUrl from './fixtures/api/createWebhook.invalid-url.json';
import runTaskActive from './fixtures/api/runTask.active.json';
import doc from './fixtures/openapi.v1.json';
import { executeContext, loadOptionsContext, locator } from './helpers/context';

vi.mock('n8n-workflow', async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	sleep: vi.fn(async () => {}),
}));

const DOC_ID = 'https://kadmo.test/openapi.v1.json';
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema(doc, DOC_ID);

const pointer = (...parts: string[]) =>
	`${DOC_ID}#/${parts.map((part) => part.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;

function requestValidator(path: string) {
	const validate = ajv.getSchema(pointer('paths', path, 'post', 'requestBody', 'content', 'application/json', 'schema'));
	if (!validate) throw new Error(`No request schema for POST ${path}`);
	return validate;
}

function expectValid(path: string, body: IDataObject) {
	const validate = requestValidator(path);
	const valid = validate(body);
	expect(validate.errors ?? []).toEqual([]);
	expect(valid).toBe(true);
}

const paths = doc.paths as Record<string, Record<string, unknown>>;

describe('request bodies match the OpenAPI request schemas', () => {
	it('POST /jobs: with none of the options', () => {
		expectValid('/jobs', dispatchBody('main', 'se-work', null, {}));
	});

	it('POST /jobs: with every option', () => {
		expectValid(
			'/jobs',
			dispatchBody(
				'main',
				'se-work',
				{ ticket_url: 'https://example.atlassian.net/browse/PROJ-1', count: 3, flags: { a: true }, empty: '' },
				{
					effort: 'high',
					idempotencyKey: 'own',
					extraInputs: { input: [{ name: 'hint', value: 'Look' }, { name: 'blank', value: '' }] },
				},
			),
		);
	});

	it('POST /tasks: with none of the options', () => {
		expectValid('/tasks', createTaskBody('main', 'Fix the login', {}));
	});

	it('POST /tasks: with every option', () => {
		for (const tracker of ['workspace', 'internal']) {
			for (const priority of ['highest', 'high', 'medium', 'low', 'lowest']) {
				expectValid(
					'/tasks',
					createTaskBody('main', 'Fix the login', {
						description: 'It loops.\n\n**Markdown**',
						type: 'Bug',
						priority,
						tracker,
						idempotencyKey: 'own',
					}),
				);
			}
		}
	});

	it('POST /tasks/{key}/runs: with none of the options', () => {
		expectValid('/tasks/{key}/runs', runPlaybookBody('bug-fix', {}));
	});

	it('POST /tasks/{key}/runs: with every option', () => {
		expectValid(
			'/tasks/{key}/runs',
			runPlaybookBody('bug-fix', {
				workspace: 'full',
				effort: 'high',
				hint: 'Look at the cookie.',
				syncStatus: false,
				validate: true,
				idempotencyKey: 'own',
			}),
		);
	});

	it('the schemas are closed: an unknown field is refused', () => {
		const validate = requestValidator('/jobs');
		expect(validate({ workflow: 'w', workspace: 'm', extra: 1 })).toBe(false);
		expect(requestValidator('/tasks')({ workspace: 'm', title: 't', idempotencyKey: 'x' })).toBe(false);
		expect(requestValidator('/tasks/{key}/runs')({ playbook: 'p', syncStatus: true })).toBe(false);
	});

	it('every body the node sends through execute validates', async () => {
		const bodies: Array<[string, IDataObject]> = [];
		const cases: Array<[string, IDataObject]> = [
			[
				'/jobs',
				{
					resource: 'job',
					operation: 'dispatch',
					workspace: locator('main'),
					workflow: locator('se-work'),
					inputs: { mappingMode: 'defineBelow', value: { ticket_url: 'u', n: null } },
					additionalFields: { effort: 'low', extraInputs: { input: [{ name: 'hint', value: 'h' }] } },
				},
			],
			[
				'/tasks',
				{
					resource: 'task',
					operation: 'create',
					workspace: locator('main'),
					title: 'T',
					additionalFields: { tracker: 'workspace', priority: 'medium', type: 'Task', description: 'd' },
				},
			],
			[
				'/tasks/{key}/runs',
				{
					resource: 'task',
					operation: 'runPlaybook',
					taskKey: 'MA-1',
					playbook: locator('bug-fix'),
					runOptions: { syncStatus: true, validate: false, hint: 'h', effort: 'high', workspace: 'w' },
				},
			],
		];
		for (const [path, params] of cases) {
			const { ctx, http } = executeContext({ params, replies: [{ statusCode: 201, body: {} }] });
			await new Kadmo().execute.call(ctx);
			bodies.push([path, http.calls[0].body as IDataObject]);
		}
		for (const [path, body] of bodies) expectValid(path, body);
	});
});

/** The OpenAPI path template a concrete path stands for. */
function templateOf(path: string): string | undefined {
	return Object.keys(paths).find((template) =>
		new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path),
	);
}

describe('every route the package calls exists in the contract', () => {
	it.each([
		['get', '/me'],
		['post', '/jobs'],
		['get', '/jobs/{id}'],
		['post', '/tasks'],
		['get', '/tasks/{key}'],
		['post', '/tasks/{key}/runs'],
		['get', '/workspaces'],
		['get', '/workflows'],
		['get', '/playbooks'],
		['get', '/webhooks'],
		['post', '/webhooks'],
		['delete', '/webhooks/{id}'],
	])('%s %s', (method, path) => {
		expect(paths[path]?.[method]).toBeDefined();
	});

	it('the calls the node and its methods make match a documented route', async () => {
		const recorded: string[] = [];
		const ok = () => ({ statusCode: 200, body: { data: [] } });
		const executions: IDataObject[] = [
			{ resource: 'job', operation: 'dispatch', workspace: locator('m'), workflow: locator('w') },
			{ resource: 'job', operation: 'get', jobId: '12' },
			{ resource: 'task', operation: 'create', workspace: locator('m'), title: 't' },
			{ resource: 'task', operation: 'get', taskKey: 'PROJ-7' },
			{ resource: 'task', operation: 'runPlaybook', taskKey: 'PROJ-7', playbook: locator('p') },
		];
		for (const params of executions) {
			const { ctx, http } = executeContext({ params, replies: [ok()] });
			await new Kadmo().execute.call(ctx);
			recorded.push(...http.calls.map((call) => `${String(call.method).toLowerCase()} ${call.url}`));
		}
		const { ctx, http } = loadOptionsContext({
			params: { workflow: locator('w') },
			replies: [ok(), ok(), ok(), ok(), ok()],
		});
		await searchWorkspaces.call(ctx);
		await searchWorkflows.call(ctx);
		await searchPlaybooks.call(ctx);
		await getWorkflowInputs.call(ctx);
		await kadmoRequest.call(ctx, { method: 'GET', path: '/me' });
		recorded.push(...http.calls.map((call) => `${String(call.method).toLowerCase()} ${call.url}`));

		expect(recorded).toHaveLength(10);
		for (const entry of recorded) {
			const [method, path] = entry.split(' ');
			const template = templateOf(path);
			expect(template, entry).toBeDefined();
			expect(paths[template as string][method], entry).toBeDefined();
		}
	});
});

describe('refusal bodies match the Error schema', () => {
	// The refusal schema is the one that requires both `error` and `code`.
	const schemas = doc.components.schemas as Record<string, { required?: string[] }>;
	const errorName = Object.keys(schemas).find(
		(name) => schemas[name].required?.includes('error') && schemas[name].required?.includes('code'),
	);
	const validateError = ajv.getSchema(pointer('components', 'schemas', errorName ?? 'Error'));

	it('the document names its refusal schema Error', () => {
		expect(errorName).toBe('Error');
		expect(validateError).toBeDefined();
	});

	it.each([
		[401, { error: 'The API token is not valid.', code: 'unauthorized' }],
		[429, { error: 'Too many calls. Wait a moment.', code: 'rate_limited' }],
	])('a hand-written %i body', (_status, body) => {
		expect(validateError?.(body)).toBe(true);
	});

	it.each([createJobDuplicate, createTaskPartial, runTaskActive, createWebhookInvalidUrl])(
		'the recorded $operation $status refusal',
		(fixture) => {
			expect(validateError?.(fixture.answer)).toBe(true);
		},
	);

	it('a body without a code, or with an unknown code, does not', () => {
		expect(validateError?.({ error: 'x' })).toBe(false);
		expect(validateError?.({ error: 'x', code: 'teapot' })).toBe(false);
	});
});

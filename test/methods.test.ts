import { describe, expect, it, vi } from 'vitest';

import { Kadmo } from '../nodes/Kadmo/Kadmo.node';
import { searchPlaybooks, searchWorkflows, searchWorkspaces } from '../nodes/Kadmo/methods/listSearch';
import { getWorkflowInputs } from '../nodes/Kadmo/methods/resourceMapping';
import listPlaybooks from './fixtures/api/listPlaybooks.list.json';
import listWorkflows from './fixtures/api/listWorkflows.list.json';
import listWorkspaces from './fixtures/api/listWorkspaces.list.json';
import { loadOptionsContext, locator, reply } from './helpers/context';

vi.mock('n8n-workflow', async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	sleep: vi.fn(async () => {}),
}));

const BASE_URL = 'https://app.kadmo.ai/api/v1';

describe('node methods', () => {
	it('registers the list searches and the resource mapper', () => {
		const node = new Kadmo();
		expect(node.methods.listSearch).toEqual({ searchWorkspaces, searchWorkflows, searchPlaybooks });
		expect(node.methods.resourceMapping).toEqual({ getWorkflowInputs });
	});
});

describe('searchWorkspaces', () => {
	it('lists workspaces by name with the slug as value', async () => {
		const { ctx, http } = loadOptionsContext({ replies: [reply(listWorkspaces)] });
		expect(await searchWorkspaces.call(ctx)).toEqual({ results: [{ name: 'Web', value: 'web' }] });
		expect(http.calls[0]).toMatchObject({ method: 'GET', baseURL: BASE_URL, url: '/workspaces' });
		expect(http.calls[0]).not.toHaveProperty('body');
		expect(http.calls[0].headers).toEqual({ Accept: 'application/json' });
	});

	it.each([
		['WE', 1],
		['  web ', 1],
		['', 1],
		['zzz', 0],
	])('filter %j keeps %i', async (filter, count) => {
		const { ctx } = loadOptionsContext({ replies: [reply(listWorkspaces)] });
		expect((await searchWorkspaces.call(ctx, filter)).results).toHaveLength(count);
	});
});

describe('searchWorkflows', () => {
	it('lists workflows by name with their description', async () => {
		const { ctx, http } = loadOptionsContext({ replies: [reply(listWorkflows)] });
		expect(await searchWorkflows.call(ctx)).toEqual({
			results: [{ name: 'triage', value: 'triage', description: 'Sort a ticket' }],
		});
		expect(http.calls[0]).toMatchObject({ method: 'GET', url: '/workflows' });
	});

	it('filters case-insensitively', async () => {
		const { ctx } = loadOptionsContext({ replies: [reply(listWorkflows), reply(listWorkflows)] });
		expect((await searchWorkflows.call(ctx, 'TRI')).results).toHaveLength(1);
		expect((await searchWorkflows.call(ctx, 'ship')).results).toEqual([]);
	});

	it('answers no results for an answer without data', async () => {
		const { ctx } = loadOptionsContext({ replies: [{ statusCode: 200, body: {} }] });
		expect(await searchWorkflows.call(ctx)).toEqual({ results: [] });
	});
});

describe('searchPlaybooks', () => {
	it('lists playbooks by name with the slug as value', async () => {
		const { ctx, http } = loadOptionsContext({ replies: [reply(listPlaybooks)] });
		expect(await searchPlaybooks.call(ctx)).toEqual({
			results: [{ name: 'Ship It', value: 'ship-it', description: 'Plan then verify' }],
		});
		expect(http.calls[0]).toMatchObject({ method: 'GET', url: '/playbooks' });
	});

	it('matches the filter on the name or the slug', async () => {
		const { ctx } = loadOptionsContext({
			replies: [reply(listPlaybooks), reply(listPlaybooks), reply(listPlaybooks)],
		});
		expect((await searchPlaybooks.call(ctx, 'ship it')).results).toHaveLength(1);
		expect((await searchPlaybooks.call(ctx, 'ship-')).results).toHaveLength(1);
		expect((await searchPlaybooks.call(ctx, 'bug')).results).toHaveLength(0);
	});

	it('leaves out a missing description', async () => {
		const { ctx } = loadOptionsContext({
			replies: [{ statusCode: 200, body: { data: [{ slug: 'p', name: 'P', description: null }] } }],
		});
		expect((await searchPlaybooks.call(ctx)).results).toEqual([{ name: 'P', value: 'p', description: undefined }]);
	});
});

describe('getWorkflowInputs', () => {
	it('answers one text field per parameter, required as Kadmo says, default in the name', async () => {
		const { ctx, http } = loadOptionsContext({
			params: { workflow: locator('triage') },
			replies: [reply(listWorkflows)],
		});
		const answer = await getWorkflowInputs.call(ctx);
		expect(http.calls[0]).toMatchObject({ method: 'GET', url: '/workflows' });
		expect(answer.emptyFieldsNotice).toBeUndefined();
		expect(answer.fields).toEqual([
			{
				id: 'depth',
				displayName: 'depth (default: shallow)',
				required: false,
				defaultMatch: false,
				canBeUsedToMatch: false,
				display: true,
				type: 'string',
			},
			{
				id: 'ticket_url',
				displayName: 'ticket_url',
				required: true,
				defaultMatch: false,
				canBeUsedToMatch: false,
				display: true,
				type: 'string',
			},
		]);
	});

	it('a workflow typed by name works too', async () => {
		const { ctx } = loadOptionsContext({
			params: { workflow: locator(' triage ', 'name') },
			replies: [reply(listWorkflows)],
		});
		expect((await getWorkflowInputs.call(ctx)).fields).toHaveLength(2);
	});

	it('an unknown workflow answers no fields and a notice', async () => {
		const { ctx } = loadOptionsContext({
			params: { workflow: locator('nope') },
			replies: [reply(listWorkflows)],
		});
		expect(await getWorkflowInputs.call(ctx)).toEqual({
			fields: [],
			emptyFieldsNotice: 'No enabled workflow is named nope. Use Extra Inputs to send inputs by name.',
		});
	});

	it('a workflow without parameters says it takes no inputs', async () => {
		const { ctx } = loadOptionsContext({
			params: { workflow: locator('bare') },
			replies: [{ statusCode: 200, body: { data: [{ name: 'bare', description: null, parameters: [] }] } }],
		});
		expect(await getWorkflowInputs.call(ctx)).toEqual({
			fields: [],
			emptyFieldsNotice: 'This workflow takes no inputs',
		});
	});

	it.each([[{ workflow: locator('') }], [{}]])('no workflow chosen (%j) → a notice, no call', async (params) => {
		const { ctx, http } = loadOptionsContext({ params, replies: [reply(listWorkflows)] });
		expect(await getWorkflowInputs.call(ctx)).toEqual({
			fields: [],
			emptyFieldsNotice: 'Pick a workflow to see its inputs',
		});
		expect(http.fn).not.toHaveBeenCalled();
	});
});

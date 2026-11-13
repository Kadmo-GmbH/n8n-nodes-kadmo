import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	INodeExecutionData,
} from 'n8n-workflow';
import { vi } from 'vitest';

/** A full response as `httpRequestWithAuthentication` answers it with `returnFullResponse: true`. */
export interface Reply {
	statusCode: number;
	headers?: Record<string, unknown>;
	body: unknown;
}

/** A recorded API fixture: `{ operation, status, request?, answer }`. */
export interface ApiFixture {
	operation: string;
	status: number;
	request?: unknown;
	answer: unknown;
}

/** The reply a recorded fixture stands for. */
export function reply(fixture: ApiFixture, headers: Record<string, unknown> = {}): Reply {
	return { statusCode: fixture.status, headers, body: clone(fixture.answer) };
}

/** A refusal reply built by hand. */
export function refusal(statusCode: number, body: unknown, headers: Record<string, unknown> = {}): Reply {
	return { statusCode, headers, body };
}

/** A deep copy, so no test mutates a shared fixture. */
export function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

export const NODE_TYPE = '@kadmo/n8n-nodes-kadmo.kadmo';
export const TOOL_NODE_TYPE = '@kadmo/n8n-nodes-kadmo.kadmoTool';
export const NODE_ID = 'node-uuid';
export const EXECUTION_ID = 'exec-1';
export const DEFAULT_CREDENTIALS = { apiToken: 'kadmo_api_example', baseUrl: 'https://app.kadmo.ai' };

/** The automatic Idempotency-Key the node makes for an item of the default execution. */
export function autoKey(item = 0, run = 0, executionId = EXECUTION_ID): string {
	return ['n8n', executionId, NODE_ID, run, item].join('-');
}

export interface ContextOptions {
	/** The node's parameters: one object for every item, or one per item. */
	params?: IDataObject | IDataObject[];
	/** The input items; one empty item by default. */
	items?: INodeExecutionData[];
	/** Replies answered in order, one per HTTP call. */
	replies?: Reply[];
	credentials?: { apiToken: string; baseUrl: string };
	nodeType?: string;
	continueOnFail?: boolean;
	executionId?: string | undefined;
	runIndex?: number;
}

/** A `{ mode, value }` resource locator value as n8n stores it. */
export function locator(value: string, mode = 'list'): IDataObject {
	return { __rl: true, mode, value };
}

function readPath(source: IDataObject, name: string): unknown {
	let value: unknown = source;
	for (const part of name.split('.')) {
		if (value === null || value === undefined || typeof value !== 'object') return undefined;
		value = (value as IDataObject)[part];
	}
	return value;
}

function extract(value: unknown, options?: { extractValue?: boolean }): unknown {
	if (options?.extractValue && value && typeof value === 'object' && 'mode' in value && 'value' in value) {
		return (value as IDataObject).value;
	}
	return value;
}

function paramsFor(params: IDataObject | IDataObject[], i: number): IDataObject {
	return Array.isArray(params) ? (params[i] ?? {}) : params;
}

function makeNode(type: string): INode {
	return {
		id: NODE_ID,
		name: 'Kadmo',
		type,
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
	};
}

/** The HTTP mock: records each call's options and answers the queued replies in order. */
export function makeHttp(replies: Reply[]) {
	const queue = [...replies];
	const calls: IHttpRequestOptions[] = [];
	const credentialTypes: string[] = [];
	const fn = vi.fn(async (credentialType: string, options: IHttpRequestOptions) => {
		credentialTypes.push(credentialType);
		calls.push(clone(options));
		const next = queue.shift();
		if (!next) throw new Error(`No reply queued for ${options.method} ${options.url}`);
		return next;
	});
	return { fn, calls, credentialTypes, remaining: () => queue.length };
}

/** A fake `IExecuteFunctions` for `Kadmo.execute`. */
export function executeContext(options: ContextOptions = {}) {
	const params = options.params ?? {};
	const http = makeHttp(options.replies ?? []);
	const node = makeNode(options.nodeType ?? NODE_TYPE);
	const getCredentials = vi.fn(async (type: string) => {
		if (type !== 'kadmoApi') throw new Error(`Unexpected credential ${type}`);
		return { ...(options.credentials ?? DEFAULT_CREDENTIALS) };
	});
	const context = {
		getCredentials,
		getNode: () => node,
		getInputData: () => options.items ?? [{ json: {} }],
		continueOnFail: () => options.continueOnFail ?? false,
		getExecutionId: () => ('executionId' in options ? options.executionId : EXECUTION_ID),
		getWorkflowDataProxy: () => ({ $runIndex: options.runIndex ?? 0 }),
		getNodeParameter: (
			name: string,
			i: number,
			fallback?: unknown,
			parameterOptions?: { extractValue?: boolean },
		) => {
			const value = readPath(paramsFor(params, i), name);
			if (value === undefined) {
				if (fallback === undefined) throw new Error(`Could not get parameter "${name}"`);
				return fallback;
			}
			return extract(value, parameterOptions);
		},
		helpers: { httpRequestWithAuthentication: http.fn },
	};
	return { ctx: context as unknown as IExecuteFunctions, http, getCredentials, node };
}

/** A fake `ILoadOptionsFunctions` for list searches and the resource mapper. */
export function loadOptionsContext(options: ContextOptions = {}) {
	const params = paramsFor(options.params ?? {}, 0);
	const http = makeHttp(options.replies ?? []);
	const node = makeNode(options.nodeType ?? NODE_TYPE);
	const context = {
		getCredentials: async () => ({ ...(options.credentials ?? DEFAULT_CREDENTIALS) }),
		getNode: () => node,
		getNodeParameter: (name: string, fallback?: unknown, parameterOptions?: { extractValue?: boolean }) => {
			const value = readPath(params, name);
			return value === undefined ? fallback : extract(value, parameterOptions);
		},
		helpers: { httpRequestWithAuthentication: http.fn },
	};
	return { ctx: context as unknown as ILoadOptionsFunctions, http, node };
}

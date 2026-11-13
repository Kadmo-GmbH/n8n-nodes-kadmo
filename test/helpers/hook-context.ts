import type { IDataObject, IHookFunctions, IWebhookFunctions } from 'n8n-workflow';
import { expect, vi } from 'vitest';

export const WEBHOOK_URL = 'https://n8n.example.com/webhook/0d6c/webhook';

export interface Answer {
	statusCode: number;
	body: unknown;
	headers?: Record<string, string>;
}

/** A fake n8n hook context: the trigger's parameters, its static data and Kadmo's queued answers. */
export function hookContext(options: {
	answers: Answer[];
	staticData?: IDataObject;
	events?: string[];
	workspace?: string;
	url?: string;
}) {
	const staticData: IDataObject = options.staticData ?? {};
	const answers = [...options.answers];
	const request = vi.fn(async (...args: [string, IDataObject]) => {
		expect(args[0]).toBe('kadmoApi');
		const next = answers.shift();
		if (!next) throw new Error('no answer queued');
		return { headers: {}, ...next };
	});
	const params: Record<string, unknown> = {
		events: options.events ?? ['job.finished'],
		workspace: { mode: 'list', value: options.workspace ?? '' },
	};
	const context = {
		getCredentials: async () => ({ apiToken: 'kadmo_api_test', baseUrl: 'https://app.kadmo.ai' }),
		getNode: () => ({ id: 'trigger-id', name: 'Kadmo Trigger', type: '@kadmo/n8n-nodes-kadmo.kadmoTrigger' }),
		getNodeWebhookUrl: () => options.url ?? WEBHOOK_URL,
		getWorkflowStaticData: () => staticData,
		getNodeParameter: (name: string, fallback: unknown, opts?: { extractValue?: boolean }) => {
			const value = params[name] ?? fallback;
			if (opts?.extractValue && value && typeof value === 'object' && 'value' in value) {
				return (value as { value: unknown }).value;
			}
			return value;
		},
		helpers: { httpRequestWithAuthentication: request },
	};
	return {
		context: context as unknown as IHookFunctions,
		staticData,
		/** The options of each call, in order: method, url, body. */
		calls: () => request.mock.calls.map(([, call]) => call),
		remaining: () => answers.length,
	};
}

/** A fake n8n webhook context for one delivery. */
export function webhookContext(options: {
	headers: Record<string, string>;
	body: string;
	secret?: string;
	mode?: 'manual' | 'webhook' | 'trigger';
}) {
	const status = vi.fn();
	const json = vi.fn();
	const res = { status: status.mockImplementation(() => res), json };
	const lowerHeaders = Object.fromEntries(Object.entries(options.headers).map(([k, v]) => [k.toLowerCase(), v]));
	const context = {
		getRequestObject: () => ({ rawBody: Buffer.from(options.body, 'utf8'), headers: lowerHeaders }),
		getResponseObject: () => res,
		getHeaderData: () => lowerHeaders,
		getBodyData: () => JSON.parse(options.body) as IDataObject,
		getMode: () => options.mode ?? 'webhook',
		getWorkflowStaticData: () => (options.secret ? { webhookId: 1, webhookSecret: options.secret } : {}),
		helpers: { returnJsonArray: (data: IDataObject) => [{ json: data }] },
	};
	return { context: context as unknown as IWebhookFunctions, status, json };
}

import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
} from 'n8n-workflow';
import { sleep } from 'n8n-workflow';

import { kadmoApiError } from './errors';

/** The contexts that call Kadmo: an action, a list or input lookup, a trigger's subscription. */
export type KadmoContext = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions;

/** How often a call waits out a `429` or a key still in progress before it gives up. */
export const MAX_WAITS = 3;

/** The longest single wait, in seconds. A longer `Retry-After` is not waited out. */
export const MAX_WAIT_S = 20;

/** The codes worth waiting for. `daily_cap_reached` is not: its `Retry-After` counts to midnight. */
const WAIT_CODES = new Set(['rate_limited', 'idempotency_in_progress']);

export interface KadmoRequest {
	method: IHttpRequestMethods;
	/** The path under `/api/v1`, starting with a slash. */
	path: string;
	body?: IDataObject;
	qs?: IDataObject;
	headers?: Record<string, string>;
	/** The item the call is made for: named in the message of a refusal. */
	itemIndex?: number;
}

export interface KadmoResponse {
	status: number;
	body: IDataObject;
}

interface FullResponse {
	statusCode: number;
	headers?: Record<string, unknown>;
	body: unknown;
}

/**
 * The API's base URL from the app's address in the credential: a trailing slash or a pasted `/api/v1` is tolerated.
 */
export function apiBaseUrl(baseUrl: string): string {
	const app = baseUrl
		.trim()
		.replace(/\/+$/, '')
		.replace(/\/api\/v1$/, '');
	return `${app}/api/v1`;
}

/** The wait a `Retry-After` header asks for, in milliseconds, or undefined when it asks for more than we wait. */
export function retryAfterMs(headers: Record<string, unknown> | undefined): number | undefined {
	const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
	const seconds = raw === undefined || raw === null || raw === '' ? 1 : Number(raw);
	if (!Number.isFinite(seconds) || seconds < 0) return 1000;
	if (seconds > MAX_WAIT_S) return undefined;
	return Math.max(seconds, 1) * 1000;
}

/**
 * The one place the package calls Kadmo. A 2xx answers its status and body; a `429 rate_limited` or a
 * `409 idempotency_in_progress` is waited out by its `Retry-After` up to {@link MAX_WAITS} times; anything else
 * throws a `NodeApiError` carrying Kadmo's sentence and what to do.
 */
export async function kadmoRequest(
	this: KadmoContext,
	request: KadmoRequest,
): Promise<KadmoResponse> {
	const credentials = await this.getCredentials('kadmoApi');
	const options: IHttpRequestOptions = {
		method: request.method,
		baseURL: apiBaseUrl(String(credentials.baseUrl ?? '')),
		url: request.path,
		headers: { Accept: 'application/json', ...request.headers },
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		timeout: 60000,
	};
	if (request.qs) options.qs = request.qs;
	if (request.body) options.body = request.body;

	for (let waits = 0; ; waits++) {
		const response = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'kadmoApi',
			options,
		)) as FullResponse;
		const status = response.statusCode;
		const body = parseBody(response.body);
		if (status >= 200 && status < 300) return { status, body: (body ?? {}) as IDataObject };

		const code = body && typeof body === 'object' ? (body as IDataObject).code : undefined;
		if (waits < MAX_WAITS && typeof code === 'string' && WAIT_CODES.has(code)) {
			const waitMs = retryAfterMs(response.headers);
			if (waitMs !== undefined) {
				await sleep(waitMs);
				continue;
			}
		}
		throw kadmoApiError(this.getNode(), status, body, request.itemIndex);
	}
}

/** A body the helper left as text (a proxy's page, a JSON body sent without its type) is parsed when it is JSON. */
function parseBody(body: unknown): unknown {
	if (typeof body !== 'string') return body;
	try {
		return JSON.parse(body);
	} catch {
		return { error: undefined, raw: body.slice(0, 200) };
	}
}

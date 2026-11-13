import type { INode, JsonObject } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

/** Where a person makes or replaces an API token, said the same way everywhere. */
const TOKEN_HELP = 'Make one in Kadmo under Settings › Assistant › API tokens and paste it into the credential.';

/**
 * What to do about each of Kadmo's refusal codes. The message is always Kadmo's own sentence; this is the line under
 * it. A code missing here gets the generic line of {@link describeRefusal}.
 */
const WHAT_TO_DO: Record<string, string> = {
	unauthorized: `Check the API token in the credential: only a Kadmo API token (kadmo_api_…) opens the API. ${TOKEN_HELP}`,
	trial_expired:
		'The Kadmo trial of this account has ended. The API still reads, and starts work again once the account has a plan.',
	no_credit: 'Add credit to the Kadmo account under Settings › Billing, then run the node again.',
	budget_reached: 'Raise the budget that covers this work in Kadmo under Settings › Billing, or wait for it to reset.',
	daily_cap_reached: 'The account reached its daily usage cap. It resets at midnight UTC.',
	workspace_not_found: 'Check the Workspace parameter: pick a workspace from the list.',
	workspace_archived: 'The workspace is archived. Pick an active workspace from the list.',
	workflow_not_found: 'Check the Workflow parameter: pick an enabled workflow from the list.',
	workflow_not_runnable: 'The workflow has no steps. Add steps to it in Kadmo, or pick another workflow.',
	playbook_not_found: 'Check the Playbook parameter: pick an enabled playbook from the list.',
	playbook_not_runnable: 'The playbook has no steps. Add steps to it in Kadmo, or pick another playbook.',
	task_not_found: 'Check the Task Key: it must be a task of Kadmo’s Tasks or of the tracker the workspace files in.',
	job_not_found: 'Check the Job ID: it is the id the Dispatch operation answered.',
	webhook_not_found: 'The subscription is already gone.',
	workspace_required: 'Pick a workspace from the list.',
	invalid_request: 'Check the parameters named above.',
	invalid_idempotency_key: 'The Idempotency Key must be 1 to 255 visible ASCII characters.',
	idempotency_key_reused:
		'This Idempotency Key was used for a different request. Leave the option empty to let the node make one per item.',
	idempotency_in_progress: 'The same request is still running in Kadmo. Run the node again in a moment.',
	duplicate_job: 'The same workflow is already queued or running for this task. Nothing new was started.',
	run_active: 'A run already drives this task. Nothing new was started: follow that run, or wait until it ends.',
	webhook_limit_reached: 'The token’s member holds 100 subscriptions. Delete unused ones in Kadmo under Integrations.',
	role_not_runnable: 'No agent of the account can run the workflow’s role. Start an agent with that role in Kadmo.',
	role_not_enabled: 'The account does not enable the workflow’s role. Enable it in Kadmo under Roles.',
	model_not_in_plan: 'The work’s model is outside the account’s plan. Pick another effort, or change the plan.',
	invalid_issue_type: 'Set the Type option to one of the types listed above.',
	tracker_not_connected:
		'The workspace files in a tracker the account has not connected. Connect it in Kadmo under Integrations, or set File In to Kadmo.',
	tracker_error:
		'The tracker refused or did not answer. Running the node again in this execution answers the same result.',
	orchestrator_error:
		'The run was created but would not start. Running the node again in this execution answers the same result.',
	rate_limited:
		'Kadmo allows 120 calls a minute per API token. Put a Wait node in the loop, or send smaller batches.',
	authorisation_unavailable: 'Kadmo could not price the work just now. Run the node again in a few minutes.',
	webhook_check_unavailable: 'Kadmo could not look up the webhook address just now. Publish the workflow again in a minute.',
	payload_too_large: 'The request is over 512 KB. Shorten the description or the inputs.',
	internal_error: 'Kadmo could not complete the call. Run the node again; if it keeps happening, contact Kadmo support.',
	not_found:
		'The Base URL in the credential does not serve Kadmo’s API. Use the address of the Kadmo app, such as https://app.kadmo.ai.',
};

/**
 * Kadmo can only call a public https address. n8n shows a failed subscription's message alone, so this whole advice
 * is part of the message, not the description.
 */
export const WEBHOOK_URL_ADVICE =
	'Kadmo only calls a public https address. Set N8N_WEBHOOK_URL on this n8n to a public https address (or put a tunnel in front of it), then publish the workflow again.';

/** A refusal's body as Kadmo answers it: `{ error, code }` and, for some codes, more fields. */
export interface KadmoRefusal {
	error?: string;
	code?: string;
	details?: unknown;
	issue_types?: unknown;
	ticket_key?: string;
	run?: { url?: string } | null;
	[key: string]: unknown;
}

/** The line under the message: what to do, with the fields some codes carry. */
export function describeRefusal(status: number, refusal: KadmoRefusal): string {
	const code = refusal.code ?? '';
	const parts: string[] = [];
	if (code === 'invalid_request' && refusal.details !== undefined) {
		parts.push(`Kadmo says: ${formatDetails(refusal.details)}.`);
	}
	if (code === 'invalid_issue_type' && Array.isArray(refusal.issue_types)) {
		parts.push(`The account files these types: ${refusal.issue_types.join(', ')}.`);
	}
	if ((code === 'tracker_error' || code === 'orchestrator_error') && refusal.ticket_key) {
		parts.push(`The ticket ${refusal.ticket_key} was filed.`);
	}
	if (code === 'run_active' && refusal.run?.url) {
		parts.push(`The run: ${refusal.run.url}`);
	}
	// A 404 without Kadmo's body comes from something else at the Base URL: an address that does not serve the API.
	const notKadmo = !code && status === 404;
	parts.push(
		WHAT_TO_DO[notKadmo ? 'not_found' : code] ??
			(status >= 500
				? 'Kadmo could not complete the call. Run the node again in a few minutes.'
				: `Kadmo answered ${status}${code ? ` (${code})` : ''}.`),
	);
	return parts.join(' ');
}

/** `details` of an `invalid_request`, one entry per field. */
function formatDetails(details: unknown): string {
	if (Array.isArray(details)) {
		return details
			.map((entry) => {
				if (entry && typeof entry === 'object') {
					const { path, field, message } = entry as { path?: unknown; field?: unknown; message?: unknown };
					const name = Array.isArray(path) ? path.join('.') : (field ?? path);
					return name ? `${String(name)}: ${String(message ?? '')}` : String(message ?? '');
				}
				return String(entry);
			})
			.join('; ');
	}
	if (details && typeof details === 'object') {
		return Object.entries(details as Record<string, unknown>)
			.map(([field, message]) => `${field}: ${Array.isArray(message) ? message.join(', ') : String(message)}`)
			.join('; ');
	}
	return String(details);
}

/** The message: Kadmo's own sentence, or what was answered when the body is not Kadmo's. */
export function refusalMessage(status: number, refusal: KadmoRefusal): string {
	const sentence =
		typeof refusal.error === 'string' && refusal.error.trim()
			? refusal.error.trim()
			: `Kadmo answered ${status}${refusal.code ? ` (${refusal.code})` : ''}`;
	if (refusal.code === 'invalid_webhook_url') return `${sentence} ${WEBHOOK_URL_ADVICE}`;
	return sentence;
}

/**
 * The error a node throws for a refusal. `httpCode` is passed on purpose: n8n looks for a status under a `code` key
 * too, and would otherwise take Kadmo's code (`job_not_found`) for it.
 */
export function kadmoApiError(
	node: INode,
	status: number,
	body: unknown,
	itemIndex?: number,
): NodeApiError {
	const refusal: KadmoRefusal =
		body && typeof body === 'object' && !Array.isArray(body) ? (body as KadmoRefusal) : {};
	const message = refusalMessage(status, refusal);
	return new NodeApiError(node, refusal as JsonObject, {
		message: itemIndex === undefined ? message : `${message} [item ${itemIndex}]`,
		description: describeRefusal(status, refusal),
		httpCode: String(status),
		itemIndex,
	});
}

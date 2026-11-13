import type { IDataObject, IHookFunctions } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { kadmoRequest } from '../transport/request';

/** What the trigger keeps in its static data between publishing and each delivery. */
export interface SubscriptionData {
	webhookId?: number;
	webhookSecret?: string;
}

/** The subscription the trigger's parameters ask for. */
export interface WantedSubscription {
	url: string;
	events: string[];
	/** A workspace's slug; empty for every workspace. */
	workspace: string;
}

export function wantedSubscription(this: IHookFunctions): WantedSubscription {
	const events = (this.getNodeParameter('events', []) as string[]).filter(Boolean);
	return {
		url: this.getNodeWebhookUrl('default') ?? '',
		events,
		workspace: String(this.getNodeParameter('workspace', '', { extractValue: true }) ?? '').trim(),
	};
}

/** Whether a listed subscription is the one wanted, and still delivering. */
export function matches(listed: IDataObject, wanted: WantedSubscription): boolean {
	const listedEvents = Array.isArray(listed.events) ? (listed.events as string[]) : [];
	const sameEvents =
		listedEvents.length === new Set(wanted.events).size && wanted.events.every((event) => listedEvents.includes(event));
	const workspace = listed.workspace as IDataObject | null | undefined;
	const listedWorkspace = workspace && typeof workspace === 'object' ? String(workspace.slug ?? '') : '';
	return (
		listed.status === 'active' && listed.url === wanted.url && sameEvents && listedWorkspace === wanted.workspace
	);
}

async function listSubscriptions(this: IHookFunctions): Promise<IDataObject[]> {
	const { body } = await kadmoRequest.call(this, { method: 'GET', path: '/webhooks' });
	return Array.isArray(body.data) ? (body.data as IDataObject[]) : [];
}

/** Deletes one subscription; one already gone counts as deleted. */
async function deleteSubscription(this: IHookFunctions, id: number): Promise<void> {
	try {
		await kadmoRequest.call(this, { method: 'DELETE', path: `/webhooks/${id}` });
	} catch (error) {
		const gone = error instanceof NodeApiError && error.httpCode === '404';
		if (gone) return;
		const nodeError =
			error instanceof NodeApiError ? error : new NodeApiError(this.getNode(), { message: String(error) });
		throw nodeError;
	}
}

function clear(data: IDataObject): void {
	delete data.webhookId;
	delete data.webhookSecret;
}

/**
 * True only when the stored subscription is listed, active, and has this URL, these events and this workspace. One
 * that differs or was disabled is deleted, so that n8n calls `create` next.
 */
export async function subscriptionExists(this: IHookFunctions): Promise<boolean> {
	const data = this.getWorkflowStaticData('node');
	const id = data.webhookId as number | undefined;
	if (!id || !data.webhookSecret) return false;

	const listed = (await listSubscriptions.call(this)).find((entry) => entry.id === id);
	if (listed && matches(listed, wantedSubscription.call(this))) return true;
	if (listed) await deleteSubscription.call(this, id);
	clear(data);
	return false;
}

/**
 * Subscribes this trigger's URL. Subscriptions left on the same URL by an earlier attempt are deleted first, so one
 * URL has one subscription. The id and the secret, answered this once, go into the node's static data.
 */
export async function subscribe(this: IHookFunctions): Promise<boolean> {
	const wanted = wantedSubscription.call(this);
	for (const entry of await listSubscriptions.call(this)) {
		if (entry.url === wanted.url) await deleteSubscription.call(this, entry.id as number);
	}
	const body: IDataObject = { url: wanted.url, events: wanted.events };
	if (wanted.workspace) body.workspace = wanted.workspace;
	const { body: created } = await kadmoRequest.call(this, { method: 'POST', path: '/webhooks', body });

	const data = this.getWorkflowStaticData('node');
	data.webhookId = created.id as number;
	data.webhookSecret = created.secret as string;
	return true;
}

/** Deletes the stored subscription and any other on this URL, then forgets the id and the secret. */
export async function unsubscribe(this: IHookFunctions): Promise<boolean> {
	const data = this.getWorkflowStaticData('node');
	const url = this.getNodeWebhookUrl('default');
	const ids = new Set<number>();
	if (data.webhookId) ids.add(data.webhookId as number);
	for (const entry of await listSubscriptions.call(this)) {
		if (url && entry.url === url) ids.add(entry.id as number);
	}
	for (const id of ids) await deleteSubscription.call(this, id);
	clear(data);
	return true;
}

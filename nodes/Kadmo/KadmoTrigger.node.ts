import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { workspaceLocator } from './descriptions/common';
import { verifySignature } from './helpers/signature';
import { subscribe, subscriptionExists, unsubscribe } from './helpers/subscription';
import { searchWorkspaces } from './methods/listSearch';

function header(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value.join(',') : value;
}

export class KadmoTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Kadmo Trigger',
		name: 'kadmoTrigger',
		icon: { light: 'file:kadmo.svg', dark: 'file:kadmo.dark.svg' },
		group: ['trigger'],
		version: [1],
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when a Kadmo job finishes or needs input, or a task is done',
		defaults: {
			name: 'Kadmo Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'kadmoApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		triggerPanel: {
			header: 'Kadmo sends an event when it happens',
			executionsHelp: {
				inactive:
					'Kadmo sends Job Finished 30 seconds to 10 minutes after a job ends, once its report has arrived; Job Needs Input 2 minutes after an agent asks, if the question is still open; Task Done at once. To test the connection now, click Listen for Test Event, then Send Test on the subscription in Kadmo under Integrations › Outgoing webhooks: a ping event arrives. Publish the workflow to receive events without listening.',
				active:
					'The workflow is published: Kadmo sends each chosen event here. A ping sent with Send Test is acknowledged and starts nothing.',
			},
			activationHint: 'Publish the workflow to let Kadmo send events here.',
		},
		properties: [
			{
				displayName: 'Trigger On',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['job.finished'],
				options: [
					{
						name: 'Job Finished',
						value: 'job.finished',
						description: 'A job succeeded, failed or was cancelled',
					},
					{
						name: 'Job Needs Input',
						value: 'job.needs_input',
						description: 'A job waits on a person: a question, a plan or an approval',
					},
					{
						name: 'Task Done',
						value: 'task.done',
						description: 'A task’s run resolved it, or closed it with nothing to do',
					},
				],
			},
			workspaceLocator({
				description: 'Only the events of this workspace. Empty: every workspace.',
			}),
		],
	};

	methods = {
		listSearch: { searchWorkspaces },
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return await subscriptionExists.call(this);
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return await subscribe.call(this);
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return await unsubscribe.call(this);
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const res = this.getResponseObject();
		const headers = this.getHeaderData();
		const secret = this.getWorkflowStaticData('node').webhookSecret as string | undefined;

		const verified =
			!!secret &&
			!!req.rawBody &&
			verifySignature({
				secret,
				header: header(headers['kadmo-signature']),
				timestamp: header(headers['kadmo-timestamp']),
				rawBody: req.rawBody,
				nowS: Math.floor(Date.now() / 1000),
			});
		if (!verified) {
			// Kadmo logs the 401 and tries again; nothing starts here.
			res.status(401).json({ error: 'The signature does not match this subscription.' });
			return { noWebhookResponse: true };
		}

		const event = this.getBodyData() as IDataObject;
		if (event.type === 'ping' && this.getMode() !== 'manual') {
			// A ping tests the connection: it is shown while listening for a test event and starts nothing otherwise.
			res.status(200).json({ received: true });
			return { noWebhookResponse: true };
		}

		return { workflowData: [this.helpers.returnJsonArray(event)] };
	}
}

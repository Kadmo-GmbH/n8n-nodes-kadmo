import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { jobFields, jobOperations } from './descriptions/job';
import { outputFields } from './descriptions/output';
import { taskFields, taskOperations } from './descriptions/task';
import { selectFields, simplifyJob, simplifyTask } from './helpers/simplify';
import { searchPlaybooks, searchWorkflows, searchWorkspaces } from './methods/listSearch';
import { getWorkflowInputs } from './methods/resourceMapping';
import { idempotencyKey } from './transport/idempotency';
import { kadmoRequest } from './transport/request';

/** What an operation answers: the object, and whether it is a job or a task for the output step. */
interface Answer {
	kind: 'job' | 'task' | 'run';
	body: IDataObject;
}

export class Kadmo implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Kadmo',
		name: 'kadmo',
		icon: { light: 'file:kadmo.svg', dark: 'file:kadmo.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Dispatch jobs, create tasks and run playbooks in Kadmo',
		defaults: {
			name: 'Kadmo',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'kadmoApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Job',
						value: 'job',
					},
					{
						name: 'Task',
						value: 'task',
					},
				],
				default: 'job',
			},
			...jobOperations,
			...jobFields,
			...taskOperations,
			...taskFields,
			...outputFields,
		],
	};

	methods = {
		listSearch: { searchWorkspaces, searchWorkflows, searchPlaybooks },
		resourceMapping: { getWorkflowInputs },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const isTool = this.getNode().type.endsWith('Tool');

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const answer = await runOperation.call(this, resource, operation, i);
				returnData.push({ json: shape.call(this, answer, i, isTool), pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: error.message, description: error.description ?? null },
						pairedItem: { item: i },
					});
					continue;
				}
				// A refusal is already a NodeApiError with Kadmo's text; anything else is wrapped with its item.
				const nodeError =
					error instanceof NodeApiError || error instanceof NodeOperationError
						? error
						: new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
				throw nodeError;
			}
		}

		return [returnData];
	}
}

async function runOperation(
	this: IExecuteFunctions,
	resource: string,
	operation: string,
	i: number,
): Promise<Answer> {
	if (resource === 'job' && operation === 'dispatch') {
		const options = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
		const body = dispatchBody(
			String(this.getNodeParameter('workspace', i, '', { extractValue: true })),
			String(this.getNodeParameter('workflow', i, '', { extractValue: true })),
			this.getNodeParameter('inputs.value', i, null) as IDataObject | null,
			options,
		);
		const { body: job } = await kadmoRequest.call(this, {
			method: 'POST',
			path: '/jobs',
			body,
			headers: { 'Idempotency-Key': idempotencyKey.call(this, i, String(options.idempotencyKey ?? '')) },
			itemIndex: i,
		});
		return { kind: 'job', body: job };
	}

	if (resource === 'job' && operation === 'get') {
		const id = String(this.getNodeParameter('jobId', i)).trim();
		if (!/^\d+$/.test(id)) {
			throw new NodeOperationError(this.getNode(), `The Job ID must be a number, not "${id}" [item ${i}]`, {
				itemIndex: i,
				description: 'Use the id the Dispatch operation answered.',
			});
		}
		const { body: job } = await kadmoRequest.call(this, { method: 'GET', path: `/jobs/${id}`, itemIndex: i });
		return { kind: 'job', body: job };
	}

	if (resource === 'task' && operation === 'create') {
		const options = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
		const body = createTaskBody(
			String(this.getNodeParameter('workspace', i, '', { extractValue: true })),
			String(this.getNodeParameter('title', i)),
			options,
		);
		const { body: task } = await kadmoRequest.call(this, {
			method: 'POST',
			path: '/tasks',
			body,
			headers: { 'Idempotency-Key': idempotencyKey.call(this, i, String(options.idempotencyKey ?? '')) },
			itemIndex: i,
		});
		return { kind: 'task', body: task };
	}

	if (resource === 'task' && operation === 'get') {
		const key = taskKeyPath.call(this, i);
		const { body: task } = await kadmoRequest.call(this, { method: 'GET', path: `/tasks/${key}`, itemIndex: i });
		return { kind: 'task', body: task };
	}

	if (resource === 'task' && operation === 'runPlaybook') {
		const key = taskKeyPath.call(this, i);
		const options = this.getNodeParameter('runOptions', i, {}) as IDataObject;
		const body = runPlaybookBody(
			String(this.getNodeParameter('playbook', i, '', { extractValue: true })),
			options,
		);
		const { body: run } = await kadmoRequest.call(this, {
			method: 'POST',
			path: `/tasks/${key}/runs`,
			body,
			headers: { 'Idempotency-Key': idempotencyKey.call(this, i, String(options.idempotencyKey ?? '')) },
			itemIndex: i,
		});
		return { kind: 'run', body: run };
	}

	throw new NodeOperationError(this.getNode(), `The operation "${operation}" is not known [item ${i}]`, {
		itemIndex: i,
	});
}

function taskKeyPath(this: IExecuteFunctions, i: number): string {
	const key = String(this.getNodeParameter('taskKey', i)).trim();
	if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(key)) {
		throw new NodeOperationError(this.getNode(), `"${key}" is not a task key [item ${i}]`, {
			itemIndex: i,
			description: 'A task key looks like PROJ-123: letters, digits, dots, dashes and underscores.',
		});
	}
	return encodeURIComponent(key);
}

/** `POST /jobs`: the workflow's inputs from the mapper and Extra Inputs, empty ones left out, all as text. */
export function dispatchBody(
	workspace: string,
	workflow: string,
	mapped: IDataObject | null,
	options: IDataObject,
): IDataObject {
	const input: Record<string, string> = {};
	for (const [name, value] of Object.entries(mapped ?? {})) {
		if (value === null || value === undefined || value === '') continue;
		input[name] = typeof value === 'object' ? JSON.stringify(value) : String(value);
	}
	const extra = (options.extraInputs as IDataObject | undefined)?.input;
	if (Array.isArray(extra)) {
		for (const entry of extra as IDataObject[]) {
			const name = String(entry.name ?? '').trim();
			if (name) input[name] = String(entry.value ?? '');
		}
	}
	const body: IDataObject = { workflow: workflow.trim(), workspace: workspace.trim() };
	if (Object.keys(input).length) body.input = input;
	const effort = String(options.effort ?? '').trim();
	if (effort) body.effort = effort;
	return body;
}

/** `POST /tasks`. */
export function createTaskBody(workspace: string, title: string, options: IDataObject): IDataObject {
	const body: IDataObject = { workspace: workspace.trim(), title: title.trim() };
	if (typeof options.description === 'string' && options.description) body.description = options.description;
	const type = String(options.type ?? '').trim();
	if (type) body.type = type;
	if (options.priority) body.priority = options.priority;
	if (options.tracker) body.tracker = options.tracker;
	return body;
}

/** `POST /tasks/{key}/runs`. */
export function runPlaybookBody(playbook: string, options: IDataObject): IDataObject {
	const body: IDataObject = { playbook: playbook.trim() };
	const workspace = String(options.workspace ?? '').trim();
	if (workspace) body.workspace = workspace;
	const effort = String(options.effort ?? '').trim();
	if (effort) body.effort = effort;
	if (typeof options.hint === 'string' && options.hint) body.hint = options.hint;
	if (typeof options.syncStatus === 'boolean') body.sync_status = options.syncStatus;
	if (typeof options.validate === 'boolean') body.validate = options.validate;
	return body;
}

/** The output item: Simplify on the node, Output and Fields on its AI-tool variant. */
function shape(this: IExecuteFunctions, answer: Answer, i: number, isTool: boolean): IDataObject {
	const mode = isTool
		? (this.getNodeParameter('output', i, 'simplified') as string)
		: this.getNodeParameter('simplify', i, true)
			? 'simplified'
			: 'raw';
	if (mode === 'raw') return answer.body;

	if (answer.kind === 'run') {
		// A run answers { task, run, waiting_on }: the task is shaped, the rest kept as answered.
		const task = (answer.body.task ?? {}) as IDataObject;
		return { ...answer.body, task: shapeObject.call(this, 'task', task, mode, i) };
	}
	return shapeObject.call(this, answer.kind, answer.body, mode, i);
}

function shapeObject(
	this: IExecuteFunctions,
	kind: 'job' | 'task',
	object: IDataObject,
	mode: string,
	i: number,
): IDataObject {
	if (mode === 'selected') {
		const fields = String(this.getNodeParameter('fields', i, ''))
			.split(',')
			.map((field) => field.trim())
			.filter(Boolean);
		return selectFields(object, fields, kind === 'job' ? 'id' : 'key');
	}
	return kind === 'job' ? simplifyJob(object) : simplifyTask(object);
}

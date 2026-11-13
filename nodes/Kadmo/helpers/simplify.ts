import type { IDataObject } from 'n8n-workflow';

/** The fields a simplified job keeps: what a workflow branches on and links to. */
export const SIMPLE_JOB_FIELDS = [
	'id',
	'status',
	'workflow',
	'task',
	'url',
	'question',
	'verdict',
	'summary',
	'pull_requests',
	'error',
] as const;

/** The fields a simplified task keeps. */
export const SIMPLE_TASK_FIELDS = [
	'key',
	'title',
	'status',
	'type',
	'tracker',
	'workspace',
	'priority',
	'playbook',
	'run_status',
	'url',
] as const;

function asObject(value: unknown): IDataObject | undefined {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as IDataObject) : undefined;
}

/** A job in at most ten flat fields: nested objects become their slug, key or text. */
export function simplifyJob(job: IDataObject): IDataObject {
	const task = asObject(job.task);
	const needsInput = asObject(job.needs_input);
	const result = asObject(job.result);
	return {
		id: job.id,
		status: job.status,
		workflow: job.workflow,
		task: task?.key ?? null,
		url: job.url,
		question: needsInput?.question ?? null,
		verdict: result?.verdict ?? null,
		summary: result?.summary ?? null,
		pull_requests: Array.isArray(result?.pull_requests) ? result.pull_requests : [],
		error: job.error ?? null,
	};
}

/** A task in at most ten flat fields. */
export function simplifyTask(task: IDataObject): IDataObject {
	return {
		key: task.key,
		title: task.title,
		status: task.status,
		type: task.type,
		tracker: task.tracker,
		workspace: asObject(task.workspace)?.slug ?? null,
		priority: task.priority ?? null,
		playbook: asObject(task.playbook)?.slug ?? null,
		run_status: asObject(task.run)?.status ?? null,
		url: task.url,
	};
}

/** The top-level fields asked for, always with the object's id or key. */
export function selectFields(object: IDataObject, fields: string[], idField: 'id' | 'key'): IDataObject {
	const picked: IDataObject = { [idField]: object[idField] };
	for (const field of fields) {
		if (field in object) picked[field] = object[field];
	}
	return picked;
}

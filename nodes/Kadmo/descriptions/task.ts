import type { INodeProperties } from 'n8n-workflow';

import { effortOption, idempotencyKeyOption, workspaceLocator } from './common';

const show = (operation: string[]) => ({ show: { resource: ['task'], operation } });

export const taskOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['task'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'File a task in the workspace’s tracker or in Kadmo, without starting it',
				action: 'Create task',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a task with its status, its playbook and its runs',
				action: 'Get task',
			},
			{
				name: 'Run Playbook',
				value: 'runPlaybook',
				description: 'Approve a task with a playbook so that its run starts',
				action: 'Run playbook on task',
			},
		],
		default: 'create',
	},
];

const taskKey: INodeProperties = {
	displayName: 'Task Key',
	name: 'taskKey',
	type: 'string',
	default: '',
	required: true,
	placeholder: 'e.g. PROJ-123',
	description: 'The task’s key, as its tracker or Kadmo gave it',
	displayOptions: show(['get', 'runPlaybook']),
};

export const taskFields: INodeProperties[] = [
	workspaceLocator({
		required: true,
		description: 'The workspace the task belongs to',
		displayOptions: show(['create']),
	}),
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. Fix the login redirect',
		displayOptions: show(['create']),
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['create']),
		options: [
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'The ticket’s description, as plain text or Markdown',
			},
			{
				displayName: 'File In',
				name: 'tracker',
				type: 'options',
				options: [
					{
						name: 'Kadmo',
						value: 'internal',
						description: 'File a Kadmo task',
					},
					{
						name: 'The Workspace’s Tracker',
						value: 'workspace',
						description: 'File where the workspace files new tasks: its tracker project, else Kadmo',
					},
				],
				default: 'workspace',
			},
			idempotencyKeyOption,
			{
				displayName: 'Priority',
				name: 'priority',
				type: 'options',
				options: [
					{ name: 'High', value: 'high' },
					{ name: 'Highest', value: 'highest' },
					{ name: 'Low', value: 'low' },
					{ name: 'Lowest', value: 'lowest' },
					{ name: 'Medium', value: 'medium' },
				],
				default: 'medium',
			},
			{
				displayName: 'Type',
				name: 'type',
				type: 'string',
				default: '',
				placeholder: 'e.g. Bug',
				description: 'An issue type. Empty: Task.',
			},
		],
	},
	taskKey,
	{
		displayName: 'Playbook',
		name: 'playbook',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'The playbook to run on the task',
		displayOptions: show(['runPlaybook']),
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchPlaybooks', searchable: true },
			},
			{
				displayName: 'By Slug',
				name: 'slug',
				type: 'string',
				placeholder: 'e.g. bug-fix',
			},
		],
	},
	{
		displayName: 'Additional Fields',
		name: 'runOptions',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['runPlaybook']),
		options: [
			effortOption,
			{
				displayName: 'Hint',
				name: 'hint',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description: 'A note every step’s agent reads',
			},
			idempotencyKeyOption,
			{
				displayName: 'Sync Status',
				name: 'syncStatus',
				type: 'boolean',
				default: true,
				description: 'Whether to move the ticket’s status in its tracker as the run goes',
			},
			{
				displayName: 'Validate',
				name: 'validate',
				type: 'boolean',
				default: true,
				description: 'Whether to check the delivered work once the run ends',
			},
			{
				displayName: 'Workspace Slug',
				name: 'workspace',
				type: 'string',
				default: '',
				placeholder: 'e.g. main',
				description: 'The workspace to run in. Empty: the task’s own.',
			},
		],
	},
];

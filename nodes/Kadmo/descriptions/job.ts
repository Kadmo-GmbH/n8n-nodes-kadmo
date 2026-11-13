import type { INodeProperties } from 'n8n-workflow';

import { effortOption, idempotencyKeyOption, workspaceLocator } from './common';

const show = (operation: string[]) => ({ show: { resource: ['job'], operation } });

export const jobOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['job'] } },
		options: [
			{
				name: 'Dispatch',
				value: 'dispatch',
				description: 'Queue a workflow in a workspace for an agent to run',
				action: 'Dispatch job',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a job with its status and, once finished, its result',
				action: 'Get job',
			},
		],
		default: 'dispatch',
	},
];

export const jobFields: INodeProperties[] = [
	workspaceLocator({
		required: true,
		description: 'The workspace the job runs in',
		displayOptions: show(['dispatch']),
	}),
	{
		displayName: 'Workflow',
		name: 'workflow',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'The workflow the job runs',
		displayOptions: show(['dispatch']),
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchWorkflows', searchable: true },
			},
			{
				displayName: 'By Name',
				name: 'name',
				type: 'string',
				placeholder: 'e.g. se-work',
			},
		],
	},
	{
		displayName: 'Inputs',
		name: 'inputs',
		type: 'resourceMapper',
		noDataExpression: true,
		default: { mappingMode: 'defineBelow', value: null },
		required: true,
		displayOptions: show(['dispatch']),
		typeOptions: {
			loadOptionsDependsOn: ['workflow.value'],
			resourceMapper: {
				resourceMapperMethod: 'getWorkflowInputs',
				mode: 'add',
				fieldWords: { singular: 'input', plural: 'inputs' },
				addAllFields: true,
				multiKeyMatch: false,
				supportAutoMap: false,
			},
		},
		description: 'The workflow’s inputs. An empty input is left out, so the workflow’s default applies.',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show(['dispatch']),
		options: [
			effortOption,
			{
				displayName: 'Extra Inputs',
				name: 'extraInputs',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				placeholder: 'Add Input',
				description: 'Inputs by name, for a workflow picked by an expression',
				options: [
					{
						displayName: 'Input',
						name: 'input',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
								placeholder: 'e.g. ticket_url',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},
			idempotencyKeyOption,
		],
	},
	{
		displayName: 'Job ID',
		name: 'jobId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 9001',
		description: 'The ID the Dispatch operation answered',
		displayOptions: show(['get']),
	},
];

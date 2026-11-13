import type { INodeProperties } from 'n8n-workflow';

const operations = { resource: ['job', 'task'] };

/** Simplify on the node; Output with three modes on its AI-tool variant, as n8n's UX guidelines ask. */
export const outputFields: INodeProperties[] = [
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description: 'Whether to return a simplified version of the response instead of the raw data',
		displayOptions: { show: operations, hide: { '@tool': [true] } },
	},
	{
		displayName: 'Output',
		name: 'output',
		type: 'options',
		default: 'simplified',
		displayOptions: { show: { ...operations, '@tool': [true] } },
		options: [
			{
				name: 'Simplified',
				value: 'simplified',
				description: 'Return at most ten fields',
			},
			{
				name: 'Raw',
				value: 'raw',
				description: 'Return all fields',
			},
			{
				name: 'Selected Fields',
				value: 'selected',
				description: 'Return only the fields named',
			},
		],
	},
	{
		displayName: 'Fields',
		name: 'fields',
		type: 'string',
		default: '',
		placeholder: 'e.g. status, result',
		description: 'The top-level fields to return, separated by commas. The ID or key is always returned.',
		displayOptions: { show: { ...operations, '@tool': [true], output: ['selected'] } },
	},
];

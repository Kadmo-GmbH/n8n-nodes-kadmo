import type { INodeProperties } from 'n8n-workflow';

/** A workspace, picked from the account's active workspaces or named by its slug. */
export function workspaceLocator(overrides: Partial<INodeProperties>): INodeProperties {
	return {
		displayName: 'Workspace',
		name: 'workspace',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchWorkspaces', searchable: true },
			},
			{
				displayName: 'By Slug',
				name: 'slug',
				type: 'string',
				placeholder: 'e.g. main',
			},
		],
		...overrides,
	};
}

/** The option that replaces the automatic Idempotency-Key. */
export const idempotencyKeyOption: INodeProperties = {
	displayName: 'Idempotency Key',
	name: 'idempotencyKey',
	type: 'string',
	default: '',
	placeholder: 'e.g. order-1042',
	description:
		'Kadmo answers a repeated request with the same key with its first answer, for 24 hours, so use an expression that differs per item, such as an order number from the input. Empty: the node makes one per execution, run and item, so a retry never starts the same work twice.',
};

/** The effort option of a dispatch or a run. */
export const effortOption: INodeProperties = {
	displayName: 'Effort',
	name: 'effort',
	type: 'string',
	default: '',
	placeholder: 'e.g. high',
	description:
		'An effort tier of the account, such as low, medium or high. Empty: the default of the workflow or the account.',
};

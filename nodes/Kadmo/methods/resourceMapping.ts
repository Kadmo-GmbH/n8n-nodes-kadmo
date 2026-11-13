import type { IDataObject, ILoadOptionsFunctions, ResourceMapperFields } from 'n8n-workflow';

import { kadmoRequest } from '../transport/request';

/**
 * A workflow's inputs as the fields of the Inputs mapper: one text field per parameter, required as Kadmo says. The
 * workflow is read from `GET /workflows`, the list a dispatch accepts.
 */
export async function getWorkflowInputs(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
	const name = String(this.getNodeParameter('workflow', undefined, { extractValue: true }) ?? '').trim();
	if (!name) return { fields: [], emptyFieldsNotice: 'Pick a workflow to see its inputs' };

	const { body } = await kadmoRequest.call(this, { method: 'GET', path: '/workflows' });
	const workflows = Array.isArray(body.data) ? (body.data as IDataObject[]) : [];
	const workflow = workflows.find((entry) => entry.name === name);
	if (!workflow) {
		return {
			fields: [],
			emptyFieldsNotice: `No enabled workflow is named ${name}. Use Extra Inputs to send inputs by name.`,
		};
	}
	const parameters = Array.isArray(workflow.parameters) ? (workflow.parameters as IDataObject[]) : [];
	return {
		fields: parameters.map((parameter) => ({
			id: String(parameter.name),
			displayName:
				parameter.default === null || parameter.default === undefined || parameter.default === ''
					? String(parameter.name)
					: `${String(parameter.name)} (default: ${String(parameter.default)})`,
			required: parameter.required === true,
			defaultMatch: false,
			canBeUsedToMatch: false,
			display: true,
			type: 'string',
		})),
		emptyFieldsNotice: parameters.length ? undefined : 'This workflow takes no inputs',
	};
}

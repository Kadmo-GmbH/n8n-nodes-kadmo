import type { IDataObject, ILoadOptionsFunctions, INodeListSearchItems, INodeListSearchResult } from 'n8n-workflow';

import { kadmoRequest } from '../transport/request';

async function catalog(this: ILoadOptionsFunctions, path: string): Promise<IDataObject[]> {
	const { body } = await kadmoRequest.call(this, { method: 'GET', path });
	return Array.isArray(body.data) ? (body.data as IDataObject[]) : [];
}

/** The catalog routes take no filter and their lists are short: the node filters them itself. */
function matching(items: INodeListSearchItems[], filter?: string): INodeListSearchResult {
	const needle = filter?.trim().toLowerCase();
	return {
		results: needle
			? items.filter(
					(item) =>
						item.name.toLowerCase().includes(needle) || String(item.value).toLowerCase().includes(needle),
				)
			: items,
	};
}

export async function searchWorkspaces(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const workspaces = await catalog.call(this, '/workspaces');
	return matching(
		workspaces.map((workspace) => ({ name: String(workspace.name), value: String(workspace.slug) })),
		filter,
	);
}

export async function searchWorkflows(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const workflows = await catalog.call(this, '/workflows');
	return matching(
		workflows.map((workflow) => ({
			name: String(workflow.name),
			value: String(workflow.name),
			description: workflow.description ? String(workflow.description) : undefined,
		})),
		filter,
	);
}

export async function searchPlaybooks(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const playbooks = await catalog.call(this, '/playbooks');
	return matching(
		playbooks.map((playbook) => ({
			name: String(playbook.name),
			value: String(playbook.slug),
			description: playbook.description ? String(playbook.description) : undefined,
		})),
		filter,
	);
}

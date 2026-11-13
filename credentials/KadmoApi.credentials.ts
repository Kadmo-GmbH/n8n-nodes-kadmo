import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class KadmoApi implements ICredentialType {
	name = 'kadmoApi';

	displayName = 'Kadmo API';

	icon: Icon = { light: 'file:../nodes/Kadmo/kadmo.svg', dark: 'file:../nodes/Kadmo/kadmo.dark.svg' };

	documentationUrl = 'https://github.com/Kadmo-GmbH/n8n-nodes-kadmo?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'A Kadmo API token, starting with kadmo_api_. Make one in Kadmo under Settings › Assistant › API tokens.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			required: true,
			default: 'https://app.kadmo.ai',
			placeholder: 'e.g. https://app.kadmo.ai',
			description: 'The address of the Kadmo app the token belongs to',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiToken}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.trim().replace(/\\/+$/, "").replace(/\\/api\\/v1$/, "")}}/api/v1',
			url: '/me',
			method: 'GET',
		},
	};
}

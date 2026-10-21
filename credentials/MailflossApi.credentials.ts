import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class MailflossApi implements ICredentialType {
	name = 'mailflossApi';

	// n8n's scanner requires a Title Case credential name, and 'mailfloss.com' is
	// the one lowercase form of the brand it accepts.
	displayName = 'mailfloss.com API';

	icon: Icon = {
		light: 'file:../nodes/Mailfloss/mailfloss.svg',
		dark: 'file:../nodes/Mailfloss/mailfloss.dark.svg',
	};

	documentationUrl = 'https://github.com/mailfloss/n8n-nodes-mailfloss#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: 'Find your API key in the mailfloss dashboard under Settings → API',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.mailfloss.com',
			url: '/v1/check-key',
		},
	};
}

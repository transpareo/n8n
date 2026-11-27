import type { ICredentialTestRequest, ICredentialType, Icon, INodeProperties } from 'n8n-workflow';
import { originExpression } from '../nodes/shared/workspace';

// The OAuth 2.0 client credentials grant of a workspace's API consumer.
// n8n fetches the token, which lives one hour, before the first request
// and fetches a new one when a request answers 401.
export class TranspareoOAuth2Api implements ICredentialType {
	name = 'transpareoOAuth2Api';

	displayName = 'Transpareo OAuth2 API';

	extends = ['oAuth2Api'];

	icon: Icon = {
		light: 'file:../icons/transpareo.svg',
		dark: 'file:../icons/transpareo.dark.svg',
	};

	documentationUrl = 'https://github.com/transpareo/n8n#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Workspace Address',
			name: 'workspaceUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'https://acme.example.com',
			description: 'The address of your Transpareo workspace, or of any page of it',
		},
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'hidden',
			default: 'clientCredentials',
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: `={{${originExpression('$self["workspaceUrl"]')}}}/api/oauth/token`,
		},
		{
			displayName: 'Client ID',
			name: 'clientId',
			type: 'string',
			default: '',
			required: true,
			description: 'The key of an API consumer created in the application manager',
		},
		{
			displayName: 'Client Secret',
			name: 'clientSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'The secret the application manager showed once when the API consumer was created',
		},

		// A token that asks for no scope follows what the consumer holds,
		// so a permission added in the application manager applies on the
		// next request.
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'hidden',
			default: '',
		},

		// The client id and secret go as HTTP Basic credentials.
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'hidden',
			default: 'header',
		},
	];

	// `scope` lists the permissions the token may use. An empty list
	// means the consumer may do nothing, so the test fails here,
	// before a workflow runs into a refusal.
	test: ICredentialTestRequest = {
		request: {
			baseURL: `={{${originExpression('$credentials.workspaceUrl')}}}/api`,
			url: '/me',
		},
		rules: [
			{
				type: 'responseSuccessBody',
				properties: {
					key: 'scope.length',
					value: 0,
					message:
						'The API consumer holds no permission. In the application manager, switch on its access groups or add it to a group that grants what the workflows need.',
				},
			},
		],
	};
}

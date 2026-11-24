import {
	UserError,
	type ICredentialDataDecryptedObject,
	type ICredentialTestRequest,
	type ICredentialType,
	type IHttpRequestHelper,
	type IHttpRequestOptions,
	type Icon,
	type INodeProperties,
} from 'n8n-workflow';
import { statusOf } from '../nodes/shared/transport';
import {
	CLIENT_REFUSED,
	CLIENT_REFUSED_HINT,
	issuedFor,
	tokenRequest,
} from '../nodes/shared/workspace';

type TokenAnswer = {
	access_token: string;
};

export class TranspareoApi implements ICredentialType {
	name = 'transpareoApi';

	displayName = 'Transpareo API';

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
			description: 'The address of your Transpareo workspace, without a path',
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
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'hidden',
			typeOptions: { expirable: true, password: true },
			default: '',
		},
		{
			displayName: 'Issued For',
			name: 'issuedFor',
			type: 'hidden',
			default: '',
		},
	];

	// The OAuth 2.0 client credentials grant. n8n calls this when the
	// stored token is empty and again when a request answers 401, so
	// the token, which lives one hour, renews itself.
	async preAuthentication(this: IHttpRequestHelper, credentials: ICredentialDataDecryptedObject) {
		let answer: TokenAnswer;
		try {
			answer = (await this.helpers.httpRequest(tokenRequest(credentials))) as TokenAnswer;
		} catch (error) {
			if (statusOf(error) !== 401) throw error;
			throw new UserError(CLIENT_REFUSED, { description: CLIENT_REFUSED_HINT });
		}

		return {
			accessToken: answer.access_token,
			issuedFor: issuedFor(credentials.workspaceUrl, credentials.clientId),
		};
	}

	// A token issued for another address or client id is left off,
	// so the API answers 401 and n8n fetches one for these credentials.
	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		const headers = { ...requestOptions.headers };
		const owner = String(credentials.issuedFor ?? '');
		const current = owner === '' || owner === currentOwner(credentials);
		if (current && credentials.accessToken) {
			headers.Authorization = `Bearer ${credentials.accessToken}`;
		}

		return { ...requestOptions, headers };
	}

	// `scope` lists the permissions the token may use. An empty list
	// means the consumer may do nothing, so the test fails here,
	// before a workflow runs into a refusal.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.workspaceUrl.trim().replace(/\\/+$/, "")}}/api',
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

function currentOwner(credentials: ICredentialDataDecryptedObject): string {
	try {
		return issuedFor(credentials.workspaceUrl, credentials.clientId);
	} catch {
		return '';
	}
}

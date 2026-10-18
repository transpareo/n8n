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
import { issuedFor, workspaceOrigin } from '../nodes/shared/workspace';

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
		const origin = workspaceOrigin(credentials.workspaceUrl);
		const form = new URLSearchParams({
			grant_type: 'client_credentials',
			client_id: String(credentials.clientId).trim(),
			client_secret: String(credentials.clientSecret),
		});
		const options: IHttpRequestOptions = {
			method: 'POST',
			url: `${origin}/api/oauth/token`,
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json',
			},
			body: form.toString(),
		};
		let answer: TokenAnswer;
		try {
			answer = (await this.helpers.httpRequest(options)) as TokenAnswer;
		} catch (error) {
			if (statusOf(error) !== 401) throw error;
			throw new UserError('The workspace refused the client ID or the client secret', {
				description:
					'Check both against the API consumer in the application manager. A regenerated secret replaces the old one, and a suspended consumer is refused.',
			});
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

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.workspaceUrl.trim().replace(/\\/+$/, "")}}/api',
			url: '/me',
		},
	};
}

function currentOwner(credentials: ICredentialDataDecryptedObject): string {
	try {
		return issuedFor(credentials.workspaceUrl, credentials.clientId);
	} catch {
		return '';
	}
}

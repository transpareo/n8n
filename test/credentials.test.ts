import { describe, expect, it } from 'vitest';
import type { ICredentialType } from 'n8n-workflow';
import { TranspareoOAuth2Api } from '../credentials/TranspareoOAuth2Api.credentials';
import { resolveCredentials } from './harness';

const credentials = {
	workspaceUrl: ' https://acme.example.com/ ',
	clientId: 'client-1',
	clientSecret: 'secret-1',
};

describe('TranspareoOAuth2Api credential', () => {
	const credential = new TranspareoOAuth2Api();

	it("builds on n8n's own OAuth2 credential", () => {
		expect(credential.extends).toEqual(['oAuth2Api']);
		expect(credential.name).toBe('transpareoOAuth2Api');
		expect(credential.displayName).toBe('Transpareo OAuth2 API');
	});

	it('asks for the workspace address, the client id and the secret', () => {
		const visible = credential.properties.filter((p) => p.type !== 'hidden');
		expect(visible.map((p) => p.name)).toEqual(['workspaceUrl', 'clientId', 'clientSecret']);

		const secret = visible.find((p) => p.name === 'clientSecret');
		expect(secret?.typeOptions?.password).toBe(true);
	});

	// Each of these is a field of oAuth2Api the editor would otherwise
	// show for the client credentials grant.
	it('fixes the grant, the token address, the scope and how the secret is sent', async () => {
		const hidden = credential.properties.filter((p) => p.type === 'hidden');
		expect(hidden.map((p) => p.name)).toEqual([
			'grantType',
			'accessTokenUrl',
			'scope',
			'authentication',
		]);

		const resolved = await resolveCredentials(credential, credentials);
		expect(resolved).toMatchObject({
			grantType: 'clientCredentials',
			accessTokenUrl: 'https://acme.example.com/api/oauth/token',
			scope: '',
			authentication: 'header',
		});
	});

	it('asks the workspace a pasted page belongs to for the token', async () => {
		const page = 'https://acme.example.com/en/admin/api_consumers?page=2';
		const resolved = await resolveCredentials(credential, { ...credentials, workspaceUrl: page });
		expect(resolved.accessTokenUrl).toBe('https://acme.example.com/api/oauth/token');
	});

	it('leaves fetching and renewing the token to n8n', () => {
		const type: ICredentialType = credential;
		expect(type.preAuthentication).toBeUndefined();
		expect(type.authenticate).toBeUndefined();
	});
});

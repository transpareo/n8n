import { describe, expect, it, vi } from 'vitest';
import type { IHttpRequestHelper, IHttpRequestOptions } from 'n8n-workflow';
import { TranspareoApi } from '../credentials/TranspareoApi.credentials';

const credentials = {
	workspaceUrl: 'https://acme.example.com/',
	clientId: 'client-1',
	clientSecret: 'secret-1',
};

function helperReturning(answer: object) {
	const httpRequest = vi.fn<(options: IHttpRequestOptions) => Promise<object>>(async () => answer);
	const helper = { helpers: { httpRequest } } as unknown as IHttpRequestHelper;
	return { helper, httpRequest };
}

describe('TranspareoApi credential', () => {
	const credential = new TranspareoApi();

	it('asks for the workspace address, the client id and the secret', () => {
		const visible = credential.properties.filter((p) => p.type !== 'hidden');
		expect(visible.map((p) => p.name)).toEqual(['workspaceUrl', 'clientId', 'clientSecret']);

		const secret = visible.find((p) => p.name === 'clientSecret');
		expect(secret?.typeOptions?.password).toBe(true);
	});

	it('keeps the token in an expirable hidden field', () => {
		const token = credential.properties.find((p) => p.name === 'accessToken');
		expect(token?.type).toBe('hidden');
		expect(token?.typeOptions?.expirable).toBe(true);
	});

	it('exchanges the client id and secret for a token', async () => {
		const { helper, httpRequest } = helperReturning({ access_token: 'token-1' });
		const result = await credential.preAuthentication!.call(helper, credentials);

		const options = httpRequest.mock.calls[0][0];
		expect(options.method).toBe('POST');
		expect(options.url).toBe('https://acme.example.com/api/oauth/token');
		expect(options.headers).toMatchObject({
			'Content-Type': 'application/x-www-form-urlencoded',
		});

		const form = new URLSearchParams(options.body as string);
		expect(form.get('grant_type')).toBe('client_credentials');
		expect(form.get('client_id')).toBe('client-1');
		expect(form.get('client_secret')).toBe('secret-1');

		expect(result).toEqual({
			accessToken: 'token-1',
			issuedFor: 'https://acme.example.com client-1',
		});
	});

	it('says plainly when the workspace refuses the client id or secret', async () => {
		const refusal = Object.assign(new Error('Request failed with status code 401'), {
			response: { status: 401 },
		});
		const httpRequest = vi.fn(async () => {
			throw refusal;
		});
		const helper = { helpers: { httpRequest } } as unknown as IHttpRequestHelper;

		await expect(credential.preAuthentication!.call(helper, credentials)).rejects.toThrow(
			'The workspace refused the client ID or the client secret',
		);
	});

	it('passes on any other failure of the token request', async () => {
		const outage = Object.assign(new Error('Request failed with status code 503'), {
			response: { status: 503 },
		});
		const httpRequest = vi.fn(async () => {
			throw outage;
		});
		const helper = { helpers: { httpRequest } } as unknown as IHttpRequestHelper;

		await expect(credential.preAuthentication!.call(helper, credentials)).rejects.toBe(outage);
	});

	it('refuses an address that carries a path', async () => {
		const { helper, httpRequest } = helperReturning({ access_token: 'token-1' });
		const pasted = { ...credentials, workspaceUrl: 'https://acme.example.com/en/admin' };

		await expect(credential.preAuthentication!.call(helper, pasted)).rejects.toThrow(
			'Enter the workspace address only, such as https://acme.example.com',
		);
		expect(httpRequest).not.toHaveBeenCalled();
	});

	it('refuses an address without a scheme', async () => {
		const { helper } = helperReturning({ access_token: 'token-1' });
		const bare = { ...credentials, workspaceUrl: 'acme.example.com' };

		await expect(credential.preAuthentication!.call(helper, bare)).rejects.toThrow(
			'Enter the workspace address only, such as https://acme.example.com',
		);
	});

	it('sends the token while it belongs to these credentials', async () => {
		const stored = {
			...credentials,
			accessToken: 'token-1',
			issuedFor: 'https://acme.example.com client-1',
		};
		const authenticate = credential.authenticate as (
			credentials: object,
			options: IHttpRequestOptions,
		) => Promise<IHttpRequestOptions>;
		const options = await authenticate(stored, { url: '/me', headers: { Accept: 'x' } });

		expect(options.headers).toEqual({ Accept: 'x', Authorization: 'Bearer token-1' });
	});

	it('sends the token when n8n kept no owner beside it', async () => {
		const stored = { ...credentials, accessToken: 'token-1', issuedFor: '' };
		const authenticate = credential.authenticate as (
			credentials: object,
			options: IHttpRequestOptions,
		) => Promise<IHttpRequestOptions>;
		const options = await authenticate(stored, { url: '/me' });

		expect(options.headers).toEqual({ Authorization: 'Bearer token-1' });
	});

	it('leaves a token minted for other credentials off, so n8n fetches a new one', async () => {
		const stored = {
			...credentials,
			clientId: 'client-2',
			accessToken: 'token-1',
			issuedFor: 'https://acme.example.com client-1',
		};
		const authenticate = credential.authenticate as (
			credentials: object,
			options: IHttpRequestOptions,
		) => Promise<IHttpRequestOptions>;
		const options = await authenticate(stored, { url: '/me' });

		expect(options.headers).toEqual({});
	});

	it('tests the credential against what the token allows', () => {
		expect(credential.test.request.url).toBe('/me');
		expect(credential.test.request.baseURL).toContain('$credentials.workspaceUrl');
	});

	it('fails the test on a token that may use no permission', () => {
		const rule = credential.test.rules?.find((r) => r.type === 'responseSuccessBody');
		expect(rule?.properties).toMatchObject({ key: 'scope.length', value: 0 });
	});
});

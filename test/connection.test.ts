import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
	IAuthenticateRuleResponseSuccessBody,
	INodeCredentialTestResult,
	INodeType,
} from 'n8n-workflow';
import { TranspareoOAuth2Api } from '../credentials/TranspareoOAuth2Api.credentials';
import { FakeWorkspace } from './fake-workspace';
import { runNode } from './harness';

type Refusal = {
	message: string;
	cause?: { code?: string; response?: { status: number; statusText?: string } };
};

const { test } = new TranspareoOAuth2Api();

// The node n8n's credential tester builds around a credential's test
// request: one property whose routing is the request as declared.
const tester = {
	description: {
		displayName: 'Credential test',
		name: 'credentialTest',
		group: ['input'],
		version: 1,
		description: '',
		defaults: { name: 'Credential test' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'transpareoOAuth2Api', required: true }],
		properties: [
			{
				displayName: 'Temp',
				name: 'temp',
				type: 'string',
				default: '',
				routing: { request: test.request },
			},
		],
	},
} as INodeType;

function failed(message: string): INodeCredentialTestResult {
	return { status: 'Error', message };
}

// A refused request as n8n's credential tester words it: the status
// text of an answer, else the code of a network failure, else the
// message of what the credential threw.
function refusal(error: Refusal): INodeCredentialTestResult {
	const response = error.cause?.response;
	if (response) {
		return failed(response.statusText || `Received HTTP status code: ${response.status}`);
	}
	return failed(error.cause?.code ?? error.message);
}

// The message of the first body rule the answer trips, read as n8n
// reads it: lodash `get` on the key, compared with `===`. A dotted
// path reads the same here.
function tripped(body: object): string | undefined {
	const rules = (test.rules ?? []) as IAuthenticateRuleResponseSuccessBody[];
	const rule = rules.find(({ type, properties }) => {
		if (type !== 'responseSuccessBody') return false;
		const value = properties.key
			.split('.')
			.reduce<unknown>((at, key) => (at as Record<string, unknown>)?.[key], body);
		return value === properties.value;
	});
	return rule?.properties.message;
}

// n8n's credential tester for a credential that declares a test
// request: it runs the request with a fresh token, then applies the
// rules to the answer.
async function testConnection(workspace: FakeWorkspace, data: object = {}) {
	const credentials = { workspaceUrl: `${workspace.origin}/`, ...data };
	let items;
	try {
		items = await runNode(tester, workspace, { parameters: {}, credentials });
	} catch (error) {
		return refusal(error as Refusal);
	}

	const message = tripped(items[0].json);
	if (message) return failed(message);
	return { status: 'OK', message: 'Connection successful!' };
}

describe('Transpareo connection test', () => {
	let workspace: FakeWorkspace;

	beforeEach(async () => {
		workspace = await new FakeWorkspace().start();
	});

	afterEach(async () => {
		await workspace.stop();
	});

	it('passes for a consumer holding a permission', async () => {
		workspace.on('GET', '/api/me', { body: { scope: ['product_access'] } });

		const result = await testConnection(workspace);

		expect(result.status).toBe('OK');
		const [request] = workspace.apiRequests();
		expect(request.path).toBe('/api/me');
		expect(request.headers.authorization).toBe('Bearer token-1');

		const token = workspace.requests.find((one) => one.path === '/api/oauth/token');
		const basic = Buffer.from('client-1:secret-1').toString('base64');
		expect(token?.headers.authorization).toBe(`Basic ${basic}`);
		const form = new URLSearchParams(token?.body);
		expect(Object.fromEntries(form)).toEqual({ grant_type: 'client_credentials' });
	});

	it('fails for a consumer that may do nothing', async () => {
		const body = { scope: [], inactiveAccessGroups: ['Sales'] };
		workspace.on('GET', '/api/me', { body });

		const result = await testConnection(workspace);

		expect(result.status).toBe('Error');
		expect(result.message).toContain('holds no permission');
		expect(result.message).toContain('switch on');
	});

	it('fails when the workspace refuses the client id or secret', async () => {
		workspace.on('POST', '/api/oauth/token', { status: 401, body: { error: 'invalid_client' } });

		const result = await testConnection(workspace);

		expect(result.status).toBe('Error');
		expect(result.message).toContain('Client authentication failed');
		expect(workspace.apiRequests()).toEqual([]);
	});

	it('fails for an address that carries a path, before any API call', async () => {
		const result = await testConnection(workspace, {
			workspaceUrl: 'https://acme.example.com/en/admin',
		});

		expect(result.status).toBe('Error');
		const paths = workspace.requests.map((request) => request.path);
		expect(paths).toEqual(['/en/admin/api/oauth/token']);
	});
});

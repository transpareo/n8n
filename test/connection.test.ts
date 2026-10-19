import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CredentialTestContext } from 'n8n-core';
import type {
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	INodeType,
	IWorkflowExecuteAdditionalData,
} from 'n8n-workflow';
import { Transpareo } from '../nodes/Transpareo/Transpareo.node';
import { TranspareoPollingTrigger } from '../nodes/TranspareoPollingTrigger/TranspareoPollingTrigger.node';
import { TranspareoTrigger } from '../nodes/TranspareoTrigger/TranspareoTrigger.node';
import { FakeWorkspace } from './fake-workspace';

const NODES: INodeType[] = [
	new Transpareo(),
	new TranspareoTrigger(),
	new TranspareoPollingTrigger(),
];

// n8n's credential tester runs the function a node names under
// `testedBy`, in this context, with the credential as it was entered.
async function testConnection(workspace: FakeWorkspace, data: object = {}) {
	const test = new Transpareo().methods.credentialTest.transpareoApiTest;
	const context = new CredentialTestContext({} as IWorkflowExecuteAdditionalData);
	const credential = {
		id: '1',
		name: 'Transpareo',
		type: 'transpareoApi',
		data: {
			workspaceUrl: `${workspace.origin}/`,
			clientId: 'client-1',
			clientSecret: 'secret-1',
			...data,
		},
	} as ICredentialsDecrypted;
	return await test.call(context as unknown as ICredentialTestFunctions, credential);
}

describe('Transpareo connection test', () => {
	let workspace: FakeWorkspace;

	beforeEach(async () => {
		workspace = await new FakeWorkspace().start();
	});

	afterEach(async () => {
		await workspace.stop();
	});

	// n8n takes the test of the first node it finds using the
	// credential, so every node names the same one.
	it('is named by every node using the credential', () => {
		for (const node of NODES) {
			const [credential] = node.description.credentials ?? [];
			expect(credential.testedBy).toBe('transpareoApiTest');
			expect(node.methods?.credentialTest?.transpareoApiTest).toBeTypeOf('function');
		}
	});

	it('passes for a consumer holding a permission', async () => {
		workspace.on('GET', '/api/me', { body: { scope: ['product_access'] } });

		const result = await testConnection(workspace);

		expect(result.status).toBe('OK');
		const [request] = workspace.apiRequests();
		expect(request.headers.authorization).toBe('Bearer token-1');
		const token = workspace.requests.find((one) => one.path === '/api/oauth/token');
		expect(new URLSearchParams(token?.body).get('client_id')).toBe('client-1');
	});

	it('fails for a consumer that may do nothing', async () => {
		workspace.on('GET', '/api/me', { body: { scope: [], inactiveAccessGroups: [] } });

		const result = await testConnection(workspace);

		expect(result.status).toBe('Error');
		expect(result.message).toContain('holds no permission');
	});

	it('names the switched-off access groups that keep its permissions back', async () => {
		const body = { scope: [], inactiveAccessGroups: ['Sales', 'Quality'] };
		workspace.on('GET', '/api/me', { body });

		const result = await testConnection(workspace);

		expect(result.status).toBe('Error');
		expect(result.message).toContain('"Sales", "Quality"');
		expect(result.message).toContain('switched off');
	});

	it('says plainly when the workspace refuses the client id or secret', async () => {
		workspace.on('POST', '/api/oauth/token', { status: 401, body: { error: 'invalid_client' } });

		const result = await testConnection(workspace);

		expect(result).toMatchObject({
			status: 'Error',
			message: 'The workspace refused the client ID or the client secret',
		});
	});

	it("passes on the workspace's own message", async () => {
		const answer = { error: 'TENANT_SUSPENDED', message: 'This workspace is suspended.' };
		workspace.on('GET', '/api/me', { status: 403, body: answer });

		const result = await testConnection(workspace);

		expect(result).toMatchObject({
			status: 'Error',
			message: 'This workspace is suspended. (TENANT_SUSPENDED)',
		});
	});

	it('refuses an address that carries a path', async () => {
		const result = await testConnection(workspace, {
			workspaceUrl: 'https://acme.example.com/en/admin',
		});

		expect(result.status).toBe('Error');
		expect(result.message).toContain('Enter the workspace address only');
		expect(workspace.requests).toEqual([]);
	});
});

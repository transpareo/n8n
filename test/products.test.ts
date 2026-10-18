import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { INodeType } from 'n8n-workflow';
import { TranspareoApi } from '../credentials/TranspareoApi.credentials';
import { Transpareo } from '../nodes/Transpareo/Transpareo.node';
import { FakeWorkspace } from './fake-workspace';
import { runNode } from './harness';

// The node n8n's credential tester builds around a credential's test
// request: no parameters, the request as the credential declares it.
function credentialTester(): INodeType {
	const { request } = new TranspareoApi().test;
	return {
		description: {
			displayName: 'Credential test',
			name: 'credentialTest',
			group: ['input'],
			version: 1,
			description: '',
			defaults: { name: 'Credential test' },
			inputs: ['main'],
			outputs: ['main'],
			credentials: [{ name: 'transpareoApi', required: true }],
			requestDefaults: { baseURL: request.baseURL },
			properties: [
				{
					displayName: 'Request',
					name: 'request',
					type: 'hidden',
					default: '',
					routing: { request: { url: request.url, method: request.method ?? 'GET' } },
				},
			],
		},
	} as INodeType;
}

const node = new Transpareo();

describe('Transpareo product operations', () => {
	let workspace: FakeWorkspace;

	beforeEach(async () => {
		workspace = await new FakeWorkspace().start();
	});

	afterEach(async () => {
		await workspace.stop();
	});

	it('tests the credential with a token against what it allows', async () => {
		workspace.on('GET', '/api/me', { body: { name: 'ERP integration', status: 'active' } });

		const items = await runNode(credentialTester(), workspace, {
			parameters: {},
			credentials: { workspaceUrl: `${workspace.origin}/` },
		});

		expect(items[0].json).toEqual({ name: 'ERP integration', status: 'active' });
		const [request] = workspace.apiRequests();
		expect(request.path).toBe('/api/me');
		expect(request.headers.authorization).toBe('Bearer token-1');
	});

	it('gets a product by id with the token it exchanged first', async () => {
		workspace.on('GET', '/api/products/11', { body: { id: 11, name: 'Face Cream' } });

		const items = await runNode(node, workspace, {
			parameters: {
				resource: 'product',
				operation: 'get',
				product: { __rl: true, mode: 'id', value: '11' },
			},
		});

		expect(items.map((item) => item.json)).toEqual([{ id: 11, name: 'Face Cream' }]);
		expect(workspace.tokenRequests).toBe(1);
		const [request] = workspace.apiRequests();
		expect(request.headers.authorization).toBe('Bearer token-1');
		expect(request.headers.accept).toContain('application/json');
	});

	it('fetches a new token when the API no longer honours the stored one', async () => {
		let calls = 0;
		workspace.on('GET', '/api/products/11', () => {
			calls += 1;
			if (calls === 1) return { status: 401, body: { error: 'UNAUTHORIZED' } };
			return { body: { id: 11 } };
		});

		const items = await runNode(node, workspace, {
			parameters: {
				resource: 'product',
				operation: 'get',
				product: { __rl: true, mode: 'id', value: '11' },
			},
			credentials: { accessToken: 'expired', issuedFor: '' },
		});

		expect(items.map((item) => item.json)).toEqual([{ id: 11 }]);
		expect(workspace.tokenRequests).toBe(1);
		const headers = workspace.apiRequests().map((request) => request.headers.authorization);
		expect(headers).toEqual(['Bearer expired', 'Bearer token-1']);
	});

	it('creates a product with its brand, components and property rows', async () => {
		workspace.on('POST', '/api/products', { status: 201, body: { id: 12 } });

		await runNode(node, workspace, {
			parameters: {
				resource: 'product',
				operation: 'create',
				name: 'Face Cream',
				brandName: 'NaturaCare',
				componentNames: ['Aqua', 'Glycerin'],
				properties: {
					property: [
						{ propertyTypeId: '21', value: 'LFP' },
						{ propertyTypeId: '12', value: 'Red' },
						{ propertyTypeId: '12', value: 'Blue' },
					],
				},
				additionalFields: {
					gtin: '4006381333931',
					categoryIds: ['3', '4'],
				},
			},
		});

		const [request] = workspace.apiRequests();
		expect(JSON.parse(request.body)).toEqual({
			product: {
				name: 'Face Cream',
				componentsInput: ['Aqua', 'Glycerin'],
				gtin: '4006381333931',
				categoryIds: ['3', '4'],
				propertiesInput: { '21': 'LFP', '12': ['Red', 'Blue'] },
			},
			brand: { name: 'NaturaCare' },
		});
	});

	it('creates a variant from its parent with a name alone', async () => {
		workspace.on('POST', '/api/products', { status: 201, body: { id: 13 } });

		await runNode(node, workspace, {
			parameters: {
				resource: 'product',
				operation: 'create',
				name: 'Face Cream 100 ml',
				brandName: '',
				componentNames: [],
				additionalFields: { parentId: 12 },
			},
		});

		const [request] = workspace.apiRequests();
		expect(JSON.parse(request.body)).toEqual({
			product: { name: 'Face Cream 100 ml', parentId: 12 },
		});
	});

	it('updates only the fields it names', async () => {
		workspace.on('PUT', '/api/products/12', { body: { id: 12 } });

		await runNode(node, workspace, {
			parameters: {
				resource: 'product',
				operation: 'update',
				product: { __rl: true, mode: 'list', value: '12' },
				updateFields: { name: 'Face Cream Rich', brandName: 'NaturaCare' },
			},
		});

		const [request] = workspace.apiRequests();
		expect(JSON.parse(request.body)).toEqual({
			product: { name: 'Face Cream Rich' },
			brand: { name: 'NaturaCare' },
		});
	});

	it('lists products up to the limit with the filters and the order', async () => {
		const products = [{ id: 3 }, { id: 2 }];
		workspace.on('GET', '/api/products', { body: { products } });

		const items = await runNode(node, workspace, {
			parameters: {
				resource: 'product',
				operation: 'getAll',
				returnAll: false,
				limit: 2,
				filters: {
					term: 'cream',
					brandId: 4,
					updatedSince: '2026-10-01T08:00:00.000Z',
					sort: '-updated_at',
				},
			},
		});

		expect(items.map((item) => item.json)).toEqual(products);
		const [request] = workspace.apiRequests();
		expect(request.query).toEqual({
			per_page: '2',
			term: 'cream',
			brand_id: '4',
			updated_since: '2026-10-01T08:00:00.000Z',
			sort: '-updated_at',
		});
	});

	it('follows the next page link when it returns every product', async () => {
		workspace.on('GET', '/api/products', (request) => {
			if (request.query.page === '2') return { body: { products: [{ id: 3 }] } };
			const next = `${workspace.origin}/api/products?per_page=100&page=2`;
			const headers = { Link: `<${next}>; rel="next"` };
			return { body: { products: [{ id: 1 }, { id: 2 }] }, headers };
		});

		const items = await runNode(node, workspace, {
			parameters: { resource: 'product', operation: 'getAll', returnAll: true },
		});

		expect(items.map((item) => item.json.id)).toEqual([1, 2, 3]);
		const pages = workspace.apiRequests().map((request) => request.query.page ?? '1');
		expect(pages).toEqual(['1', '2']);
		expect(workspace.apiRequests()[1].query.per_page).toBe('100');
	});
});

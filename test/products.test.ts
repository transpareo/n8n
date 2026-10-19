import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Transpareo } from '../nodes/Transpareo/Transpareo.node';
import { FakeWorkspace } from './fake-workspace';
import { runNode } from './harness';

const node = new Transpareo();

describe('Transpareo product operations', () => {
	let workspace: FakeWorkspace;

	beforeEach(async () => {
		workspace = await new FakeWorkspace().start();
	});

	afterEach(async () => {
		await workspace.stop();
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

	// The workspace's own message and code head the error, so n8n and
	// an agent using the node as a tool read what to fix first.
	it('heads a refusal with the message and the code of the workspace', async () => {
		const refusal = {
			error: 'PRODUCT_FORBIDDEN',
			message: 'Reading these records needs the product_access permission.',
			hint: 'This credential holds: dpp_read. Ask the administrator to grant product_access to the API consumer.',
			docsUrl: 'https://acme.example.com/apidocs/errors#PRODUCT_FORBIDDEN',
		};
		workspace.on('GET', '/api/products', { status: 403, body: refusal });

		const run = runNode(node, workspace, {
			parameters: { resource: 'product', operation: 'getAll', returnAll: true },
		});

		await expect(run).rejects.toMatchObject({
			message: 'Reading these records needs the product_access permission. (PRODUCT_FORBIDDEN)',
			description: expect.stringContaining('This credential holds: dpp_read.'),
		});
	});

	it('names each field a refused write names', async () => {
		const refusal = {
			error: 'PRODUCT_INVALID',
			message: 'The product is invalid.',
			fields: {
				componentsInput: {
					error: 'PRODUCT_COMPONENTS_INPUT_EMPTY',
					message: 'Components input missing',
					fullMessage: 'Components Components input missing',
				},
			},
		};
		workspace.on('POST', '/api/products', { status: 422, body: refusal });

		const run = runNode(node, workspace, {
			parameters: {
				resource: 'product',
				operation: 'create',
				name: 'Face Cream',
				brandName: 'NaturaCare',
				componentNames: [],
			},
		});

		await expect(run).rejects.toMatchObject({
			message: 'The product is invalid. (PRODUCT_INVALID)',
			description: expect.stringContaining(
				'componentsInput: Components input missing (PRODUCT_COMPONENTS_INPUT_EMPTY)',
			),
		});
	});

	it("keeps n8n's own wording for an answer without a message", async () => {
		workspace.on('GET', '/api/products/11', { status: 502, body: { status: 502 } });

		const run = runNode(node, workspace, {
			parameters: {
				resource: 'product',
				operation: 'get',
				product: { __rl: true, mode: 'id', value: '11' },
			},
		});

		await expect(run).rejects.toMatchObject({
			message: 'Bad gateway - the service failed to handle your request',
		});
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

	// The workspace refuses a product without a component, and a
	// variant takes its parent's. An empty list still runs, so a
	// variant is created with a name alone.
	it('asks for the components of a new product', () => {
		const field = node.description.properties.find((property) => {
			const operations = property.displayOptions?.show?.operation ?? [];
			return property.name === 'componentNames' && operations.includes('create');
		});

		expect(field?.required).toBe(true);
		expect(field?.description).toContain('variant');
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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Transpareo } from '../nodes/Transpareo/Transpareo.node';
import { FakeWorkspace } from './fake-workspace';
import { runNode } from './harness';

const node = new Transpareo();

describe('Transpareo component operations', () => {
	let workspace: FakeWorkspace;

	beforeEach(async () => {
		workspace = await new FakeWorkspace().start();
	});

	afterEach(async () => {
		await workspace.stop();
	});

	it('creates a component with its article number, properties and templates', async () => {
		workspace.on('POST', '/api/components', { status: 201, body: { id: 13 } });

		const items = await runNode(node, workspace, {
			parameters: {
				resource: 'component',
				operation: 'create',
				name: 'Shea Butter',
				additionalFields: {
					mpn: 'SB-RAW-25KG',
					properties: '{"new": {"12": [{"value": "Emollient"}]}}',
					templateIds: ['507'],
				},
			},
		});

		expect(items.map((item) => item.json)).toEqual([{ id: 13 }]);
		const [request] = workspace.apiRequests();
		expect(JSON.parse(request.body)).toEqual({
			component: { name: 'Shea Butter', mpn: 'SB-RAW-25KG' },
			properties: { new: { '12': [{ value: 'Emollient' }] } },
			templateIds: ['507'],
		});
	});

	it('gets a component picked from the list', async () => {
		workspace.on('GET', '/api/components/13', { body: { id: 13, name: 'Shea Butter' } });

		const items = await runNode(node, workspace, {
			parameters: {
				resource: 'component',
				operation: 'get',
				component: { __rl: true, mode: 'list', value: '13' },
			},
		});

		expect(items[0].json).toEqual({ id: 13, name: 'Shea Butter' });
	});

	it('updates the name alone', async () => {
		workspace.on('PUT', '/api/components/13', { body: { id: 13 } });

		await runNode(node, workspace, {
			parameters: {
				resource: 'component',
				operation: 'update',
				component: { __rl: true, mode: 'id', value: '13' },
				updateFields: { name: 'Shea Butter Raw' },
			},
		});

		const [request] = workspace.apiRequests();
		expect(JSON.parse(request.body)).toEqual({ component: { name: 'Shea Butter Raw' } });
	});

	it('lists the components changed since a time, recently changed first', async () => {
		workspace.on('GET', '/api/components', { body: { components: [{ id: 13 }] } });

		const items = await runNode(node, workspace, {
			parameters: {
				resource: 'component',
				operation: 'getAll',
				returnAll: false,
				limit: 10,
				filters: { updatedSince: '2026-10-01T08:00:00Z', sort: '-updated_at' },
			},
		});

		expect(items.map((item) => item.json)).toEqual([{ id: 13 }]);
		expect(workspace.apiRequests()[0].query).toEqual({
			per_page: '10',
			updated_since: '2026-10-01T08:00:00.000Z',
			sort: '-updated_at',
		});
	});

	it('refuses properties that are not a JSON object', async () => {
		await expect(
			runNode(node, workspace, {
				parameters: {
					resource: 'component',
					operation: 'create',
					name: 'Shea Butter',
					additionalFields: { properties: '[1, 2]' },
				},
			}),
		).rejects.toThrow("'Properties (JSON)' must be a JSON object");
		expect(workspace.apiRequests()).toEqual([]);
	});
});

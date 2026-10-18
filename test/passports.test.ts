import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Transpareo } from '../nodes/Transpareo/Transpareo.node';
import { FakeWorkspace, runNode } from './harness';

const node = new Transpareo();

const byCode = (code: string) => ({ __rl: true, mode: 'code', value: code });
const byId = (id: string) => ({ __rl: true, mode: 'id', value: id });

describe('Transpareo passport operations', () => {
	let workspace: FakeWorkspace;

	beforeEach(async () => {
		workspace = await new FakeWorkspace().start();
		workspace.on('GET', '/api/dpps', (request) => {
			const dpps = [
				{ id: 15, code: 'A1B2C3D4EX' },
				{ id: 14, code: 'A1B2C3D4E' },
			];
			return { body: { dpps: dpps.filter((dpp) => dpp.code.includes(request.query.term ?? '')) } };
		});
		workspace.on('GET', '/api/dpps/14', { body: { id: 14, code: 'A1B2C3D4E' } });
	});

	afterEach(async () => {
		await workspace.stop();
	});

	function body(index = 0) {
		return JSON.parse(
			workspace.apiRequests().filter((request) => request.method !== 'GET')[index].body,
		);
	}

	it('creates an item passport of a product with its lot and serial', async () => {
		workspace.on('POST', '/api/dpps', { status: 201, body: { id: 16, publishBlocked: false } });

		const items = await runNode(node, workspace, {
			parameters: {
				resource: 'passport',
				operation: 'create',
				product: { __rl: true, mode: 'id', value: '11' },
				granularity: 'item',
				batchIdentifier: 'L2026-09',
				serialIdentifier: '000412',
				additionalFields: {
					description: 'Face Cream 50ml',
					dynamicData: '{"stateOfHealth": 87.3}',
					idempotencyKey: 'create-000412',
				},
			},
		});

		expect(items[0].json).toEqual({ id: 16, publishBlocked: false });
		expect(body()).toEqual({
			dpp: {
				unlockableId: 11,
				granularity: 'item',
				batchIdentifier: 'L2026-09',
				serialIdentifier: '000412',
				description: 'Face Cream 50ml',
				dynamicData: { stateOfHealth: 87.3 },
			},
		});
		const [request] = workspace.apiRequests();
		expect(request.headers['idempotency-key']).toBe('create-000412');
	});

	it('creates a model passport in the workspace default granularity without lot fields', async () => {
		workspace.on('POST', '/api/dpps', { status: 201, body: { id: 17 } });

		await runNode(node, workspace, {
			parameters: {
				resource: 'passport',
				operation: 'create',
				product: { __rl: true, mode: 'id', value: '11' },
				granularity: '',
				batchIdentifier: 'ignored',
			},
		});

		expect(body()).toEqual({ dpp: { unlockableId: 11 } });
		expect(workspace.apiRequests()[0].headers['idempotency-key']).toBeUndefined();
	});

	it('validates a passport without writing it', async () => {
		workspace.on('POST', '/api/dpps/validate', { body: { valid: false, publishBlocked: true } });

		const items = await runNode(node, workspace, {
			parameters: {
				resource: 'passport',
				operation: 'validate',
				product: { __rl: true, mode: 'id', value: '11' },
				granularity: 'batch',
				batchIdentifier: 'L2026-09',
			},
		});

		expect(items[0].json).toEqual({ valid: false, publishBlocked: true });
		expect(body()).toEqual({
			dpp: { unlockableId: 11, granularity: 'batch', batchIdentifier: 'L2026-09' },
		});
	});

	it('reads what a passport of a product needs', async () => {
		workspace.on('GET', '/api/dpps/requirements', { body: { defaultGranularity: 'item' } });

		await runNode(node, workspace, {
			parameters: {
				resource: 'passport',
				operation: 'getRequirements',
				product: { __rl: true, mode: 'list', value: '11' },
				requirementsGranularity: 'item',
			},
		});

		expect(workspace.apiRequests()[0].query).toEqual({ productId: '11', granularity: 'item' });
	});

	it('leaves the granularity to the workspace when none is picked', async () => {
		workspace.on('GET', '/api/dpps/requirements', { body: {} });

		await runNode(node, workspace, {
			parameters: {
				resource: 'passport',
				operation: 'getRequirements',
				product: { __rl: true, mode: 'id', value: '11' },
				requirementsGranularity: '',
			},
		});

		expect(workspace.apiRequests()[0].query).toEqual({ productId: '11' });
	});

	it('gets a passport named by its code through an exact match', async () => {
		const items = await runNode(node, workspace, {
			parameters: { resource: 'passport', operation: 'get', passport: byCode('A1B2C3D4E') },
		});

		expect(items[0].json).toEqual({ id: 14, code: 'A1B2C3D4E' });
		const paths = workspace.apiRequests().map((request) => request.path);
		expect(paths).toEqual(['/api/dpps', '/api/dpps/14']);
		expect(workspace.apiRequests()[0].query.term).toBe('A1B2C3D4E');
	});

	it('names the code when no passport carries it', async () => {
		await expect(
			runNode(node, workspace, {
				parameters: { resource: 'passport', operation: 'get', passport: byCode('ZZZ') },
			}),
		).rejects.toThrow("No passport has the code 'ZZZ'");
	});

	it('publishes a passport named by its id under its code', async () => {
		workspace.on('POST', '/api/dpps/A1B2C3D4E/publish', {
			body: { code: 'A1B2C3D4E', version: 3 },
		});

		const items = await runNode(node, workspace, {
			parameters: {
				resource: 'passport',
				operation: 'publish',
				passport: byId('14'),
				publishFields: { reason: 'edit' },
			},
		});

		expect(items[0].json).toEqual({ code: 'A1B2C3D4E', version: 3 });
		expect(body()).toEqual({ reason: 'edit' });
	});

	it('updates the fields of a passport', async () => {
		workspace.on('PUT', '/api/dpps/14', { body: { id: 14 } });

		await runNode(node, workspace, {
			parameters: {
				resource: 'passport',
				operation: 'update',
				passport: byId('14'),
				updateFields: { description: 'Face Cream 50 ml' },
			},
		});

		expect(body()).toEqual({ dpp: { description: 'Face Cream 50 ml' } });
	});

	it('appends a status change that recalls a unit', async () => {
		workspace.on('POST', '/api/dpps/14/events', {
			status: 201,
			body: { event: { eventType: 'lifecycle_transition' } },
		});

		await runNode(node, workspace, {
			parameters: {
				resource: 'passport',
				operation: 'appendEvent',
				passport: byCode('A1B2C3D4E'),
				eventType: 'status_change',
				status: 'suspended',
				eventFields: { description: 'Recall 2026-10', publish: true, data: '{"recallId": "R-7"}' },
			},
		});

		expect(body()).toEqual({
			event: {
				eventType: 'status_change',
				status: 'suspended',
				description: 'Recall 2026-10',
				publish: true,
				data: { recallId: 'R-7' },
			},
		});
	});

	it('leaves the status out of an event that is no status change', async () => {
		workspace.on('POST', '/api/dpps/14/events', { status: 201, body: {} });

		await runNode(node, workspace, {
			parameters: {
				resource: 'passport',
				operation: 'appendEvent',
				passport: byId('14'),
				eventType: 'inspection',
				status: 'suspended',
				eventFields: { gln: '4012345000009' },
			},
		});

		expect(body()).toEqual({ event: { eventType: 'inspection', gln: '4012345000009' } });
	});

	it('merges dynamic data into the passport', async () => {
		workspace.on('PATCH', '/api/dpps/14/dynamic_data', {
			body: { dynamicData: { cycleCount: 412 } },
		});

		await runNode(node, workspace, {
			parameters: {
				resource: 'passport',
				operation: 'updateDynamicData',
				passport: byId('14'),
				dynamicData: '{"cycleCount": 412, "retiredReason": null}',
			},
		});

		expect(body()).toEqual({ dynamicData: { cycleCount: 412, retiredReason: null } });
	});

	it('returns the events of a passport one item each', async () => {
		const events = [{ eventType: 'published' }, { eventType: 'inspection' }];
		workspace.on('GET', '/api/dpps/14/events', { body: { events } });

		const items = await runNode(node, workspace, {
			parameters: { resource: 'passport', operation: 'getEvents', passport: byId('14') },
		});

		expect(items.map((item) => item.json)).toEqual(events);
	});

	it('returns the versions of a passport one item each', async () => {
		const versions = [{ number: 3 }, { number: 2 }];
		workspace.on('GET', '/api/dpps/14/versions', { body: { versions, count: 2 } });

		const items = await runNode(node, workspace, {
			parameters: { resource: 'passport', operation: 'getVersions', passport: byId('14') },
		});

		expect(items.map((item) => item.json)).toEqual(versions);
	});

	it('carries a correction of the product onto the passport', async () => {
		workspace.on('POST', '/api/dpps/14/correct', { body: { corrected: true, version: 4 } });

		await runNode(node, workspace, {
			parameters: {
				resource: 'passport',
				operation: 'correct',
				passport: byId('14'),
				noteFields: { description: 'Photo replaced' },
			},
		});

		expect(body()).toEqual({ description: 'Photo replaced' });
	});

	it('records a reissue naming the successor', async () => {
		workspace.on('POST', '/api/dpps/14/reissue', { body: { id: 14 } });

		await runNode(node, workspace, {
			parameters: {
				resource: 'passport',
				operation: 'reissue',
				passport: byId('14'),
				reissueFields: { successorCode: 'F9G8H7J6K', description: 'Label reprinted' },
			},
		});

		expect(body()).toEqual({ successorCode: 'F9G8H7J6K', description: 'Label reprinted' });
	});

	it('lists the passports of a product in the statuses asked for', async () => {
		await runNode(node, workspace, {
			parameters: {
				resource: 'passport',
				operation: 'getAll',
				returnAll: false,
				limit: 5,
				filters: {
					productId: 11,
					status: ['in_use', 'suspended'],
					createdSince: '2026-10-01T00:00:00Z',
				},
			},
		});

		expect(workspace.apiRequests()[0].query).toEqual({
			per_page: '5',
			product_id: '11',
			status: 'in_use,suspended',
			created_since: '2026-10-01T00:00:00.000Z',
		});
	});
});

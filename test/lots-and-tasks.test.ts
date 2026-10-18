import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Transpareo } from '../nodes/Transpareo/Transpareo.node';
import { FakeWorkspace, runNode } from './harness';

const node = new Transpareo();

describe('Transpareo lot and task operations', () => {
	let workspace: FakeWorkspace;

	beforeEach(async () => {
		workspace = await new FakeWorkspace().start();
	});

	afterEach(async () => {
		await workspace.stop();
	});

	it('gets a lot', async () => {
		workspace.on('GET', '/api/lots/7', { body: { id: 7, identifier: 'L2026-09' } });

		const items = await runNode(node, workspace, {
			parameters: {
				resource: 'lot',
				operation: 'get',
				lot: { __rl: true, mode: 'id', value: '7' },
			},
		});

		expect(items[0].json).toEqual({ id: 7, identifier: 'L2026-09' });
	});

	it('lists the lots of a product', async () => {
		workspace.on('GET', '/api/lots', { body: { lots: [{ id: 7 }] } });

		const items = await runNode(node, workspace, {
			parameters: {
				resource: 'lot',
				operation: 'getAll',
				returnAll: false,
				limit: 20,
				filters: { productId: 11, identifier: 'L2026-09' },
			},
		});

		expect(items.map((item) => item.json)).toEqual([{ id: 7 }]);
		expect(workspace.apiRequests()[0].query).toEqual({
			per_page: '20',
			product_id: '11',
			identifier: 'L2026-09',
		});
	});

	it('gets a task', async () => {
		workspace.on('GET', '/api/tasks/42', { body: { id: 42, moves: ['claim'] } });

		const items = await runNode(node, workspace, {
			parameters: {
				resource: 'task',
				operation: 'get',
				task: { __rl: true, mode: 'id', value: '42' },
			},
		});

		expect(items[0].json).toEqual({ id: 42, moves: ['claim'] });
	});

	it('lists the tasks of one list', async () => {
		workspace.on('GET', '/api/tasks', { body: { tasks: [{ id: 42 }] } });

		await runNode(node, workspace, {
			parameters: {
				resource: 'task',
				operation: 'getAll',
				list: 'requested',
				returnAll: false,
				limit: 10,
				filters: { term: 'supplier', sort: '-updated_at' },
			},
		});

		expect(workspace.apiRequests()[0].query).toEqual({
			list: 'requested',
			per_page: '10',
			term: 'supplier',
			sort: '-updated_at',
		});
	});

	it('finds whom a task may go to', async () => {
		const assignees = [{ key: 'AccessGroup:3', name: 'Group Quality' }];
		workspace.on('GET', '/api/tasks/assignees', { body: { assignees } });

		const items = await runNode(node, workspace, {
			parameters: { resource: 'task', operation: 'getAssignees', term: 'quality' },
		});

		expect(items.map((item) => item.json)).toEqual(assignees);
		expect(workspace.apiRequests()[0].query).toEqual({ term: 'quality' });
	});

	it('asks an access group for something about a passport', async () => {
		workspace.on('POST', '/api/tasks', { status: 201, body: { id: 43 } });

		await runNode(node, workspace, {
			parameters: {
				resource: 'task',
				operation: 'create',
				title: 'Check the supplier declaration',
				assignee: { __rl: true, mode: 'list', value: 'AccessGroup:3' },
				additionalFields: {
					note: 'The one for the spring range',
					dueOn: '2026-11-01T00:00:00',
					priority: 'high',
					subjectType: 'Dpp',
					subjectId: 14,
					idempotencyKey: 'ask-quality-14',
				},
			},
		});

		const [request] = workspace.apiRequests();
		expect(JSON.parse(request.body)).toEqual({
			task: {
				title: 'Check the supplier declaration',
				assigneeKey: 'AccessGroup:3',
				note: 'The one for the spring range',
				dueOn: '2026-11-01',
				priority: 'high',
				subjectKey: 'Dpp:14',
			},
		});
		expect(request.headers['idempotency-key']).toBe('ask-quality-14');
	});

	it('asks a person by key without a subject', async () => {
		workspace.on('POST', '/api/tasks', { status: 201, body: { id: 44 } });

		await runNode(node, workspace, {
			parameters: {
				resource: 'task',
				operation: 'create',
				title: 'Sign off the label',
				assignee: { __rl: true, mode: 'key', value: 'User:15' },
				additionalFields: { subjectType: 'Product' },
			},
		});

		const [request] = workspace.apiRequests();
		expect(JSON.parse(request.body)).toEqual({
			task: { title: 'Sign off the label', assigneeKey: 'User:15' },
		});
	});
});

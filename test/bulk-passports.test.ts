import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep } from 'n8n-workflow';
import { Transpareo } from '../nodes/Transpareo/Transpareo.node';
import { FakeWorkspace, type RecordedRequest } from './fake-workspace';
import { runNode } from './harness';

vi.mock('n8n-workflow', async (importOriginal) => ({
	...(await importOriginal<typeof import('n8n-workflow')>()),
	sleep: vi.fn(async () => {}),
}));

const node = new Transpareo();

const parameters = {
	resource: 'passport',
	operation: 'createMany',
	product: { __rl: true, mode: 'id', value: '={{ $json.productId }}' },
	granularity: 'item',
	batchIdentifier: 'L2026-09',
	serialIdentifier: '={{ $json.serial }}',
	additionalFields: { modelIdentifier: 'FC-50ML' },
};

function units(count: number) {
	return Array.from({ length: count }, (_, index) => ({
		productId: 11,
		serial: String(index + 1).padStart(6, '0'),
	}));
}

function lines(request: RecordedRequest) {
	return request.body
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

describe('Transpareo passport Create Many', () => {
	let workspace: FakeWorkspace;

	beforeEach(async () => {
		workspace = await new FakeWorkspace().start();
		workspace.on('GET', '/api/me', { body: { bulkItemsPerMinute: 5000 } });
		vi.mocked(sleep).mockClear();
	});

	afterEach(async () => {
		await workspace.stop();
	});

	function bulkCalls() {
		return workspace.apiRequests().filter((request) => request.path === '/api/dpps/bulk');
	}

	function acceptBulk() {
		let calls = 0;
		workspace.on('POST', '/api/dpps/bulk', (request) => {
			calls += 1;
			const rowCount = lines(request).filter((line) => !line.shared).length;
			const statusUrl = `${workspace.origin}/api/dpps/bulk/task-${calls}`;
			return { status: 202, body: { taskId: `task-${calls}`, statusUrl, rowCount } };
		});
	}

	it('sends every input item as one row of one asynchronous call and reports each row', async () => {
		acceptBulk();
		let polls = 0;
		workspace.on('GET', '/api/dpps/bulk/task-1', () => {
			polls += 1;
			if (polls === 1) return { body: { taskId: 'task-1', status: 'running', progress: 40 } };
			const done = { status: 'completed', createdCount: 2, duplicateCount: 0, errorCount: 0 };
			return { body: { taskId: 'task-1', progress: 100, errors: [], ...done } };
		});

		const items = await runNode(node, workspace, { parameters, input: units(2) });

		const [call] = bulkCalls();
		expect(call.headers['content-type']).toBe('application/x-ndjson');
		expect(call.headers.prefer).toBe('respond-async');
		expect(lines(call)).toEqual([
			{
				unlockableId: 11,
				granularity: 'item',
				batchIdentifier: 'L2026-09',
				serialIdentifier: '000001',
				modelIdentifier: 'FC-50ML',
			},
			{
				unlockableId: 11,
				granularity: 'item',
				batchIdentifier: 'L2026-09',
				serialIdentifier: '000002',
				modelIdentifier: 'FC-50ML',
			},
		]);
		expect(items.map((item) => item.json)).toEqual([
			{ row: 1, status: 'created', taskId: 'task-1' },
			{ row: 2, status: 'created', taskId: 'task-1' },
		]);
		expect(items.map((item) => item.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
		expect(polls).toBe(2);
	});

	it('sends no more rows a call than the client may write a minute, and waits as asked between calls', async () => {
		workspace.on('GET', '/api/me', { body: { bulkItemsPerMinute: 2 } });
		acceptBulk();
		let refused = false;
		workspace.on('POST', '/api/dpps/bulk', () => {
			if (refused) return { status: 202, body: { taskId: 'task-2', rowCount: 2 } };
			refused = true;
			const body = { error: 'DPP_BULK_RATE_LIMITED', message: 'Bulk item rate limit exceeded' };
			return { status: 429, body, headers: { 'Retry-After': '60' } };
		});

		const items = await runNode(node, workspace, {
			parameters: { ...parameters, waitForCompletion: false, bulkOptions: { rowsPerCall: 3 } },
			input: units(3),
		});

		expect(items.map((item) => item.json)).toEqual([
			{ taskId: 'task-2', rowCount: 2, firstRow: 1, lastRow: 2 },
			{ taskId: 'task-2', rowCount: 2, firstRow: 3, lastRow: 3 },
		]);
		expect(items[0].pairedItem).toEqual([{ item: 0 }, { item: 1 }]);
		expect(bulkCalls().map((call) => lines(call).length)).toEqual([2, 2, 1]);
		expect(vi.mocked(sleep).mock.calls.map(([ms]) => ms)).toEqual([60000]);
	});

	it('stops at a 429 that asks for an hour, with the workspace message', async () => {
		workspace.on('POST', '/api/dpps/bulk', {
			status: 429,
			body: { error: 'CONSUMER_RATE_LIMITED', message: 'Rate limit exceeded' },
			headers: { 'Retry-After': '3600' },
		});

		await expect(runNode(node, workspace, { parameters, input: units(1) })).rejects.toThrow(
			'Rate limit exceeded (CONSUMER_RATE_LIMITED)',
		);
		expect(sleep).not.toHaveBeenCalled();
	});

	it('names the review flow when the workspace reviews every publish', async () => {
		workspace.on('POST', '/api/dpps/bulk', {
			status: 409,
			body: {
				error: 'DPP_REVIEW_REQUIRED',
				message: 'This workspace reviews every publish; ask for it in the application manager.',
			},
		});

		const run = runNode(node, workspace, { parameters, input: units(1) });

		await expect(run).rejects.toMatchObject({
			message:
				'This workspace reviews every publish; ask for it in the application manager. (DPP_REVIEW_REQUIRED)',
			description: expect.stringContaining('Create Many publishes every passport it writes'),
		});
	});

	it('hands a refusal on as one item when the node continues on fail', async () => {
		workspace.on('POST', '/api/dpps/bulk', {
			status: 403,
			body: { error: 'DPP_FORBIDDEN', message: 'Creating passports in bulk needs dpp_bulk_write.' },
		});

		const items = await runNode(node, workspace, {
			parameters,
			input: units(2),
			settings: { onError: 'continueRegularOutput' },
		});

		expect(items.map((item) => item.json)).toEqual([
			{ error: 'Creating passports in bulk needs dpp_bulk_write. (DPP_FORBIDDEN)' },
		]);
		expect(items[0].pairedItem).toEqual([{ item: 0 }, { item: 1 }]);
	});

	it('sends the shared fields as the first line every row merges over', async () => {
		acceptBulk();
		workspace.on('GET', '/api/dpps/bulk/task-1', {
			body: { taskId: 'task-1', status: 'completed', createdCount: 0, duplicateCount: 1 },
		});

		const items = await runNode(node, workspace, {
			parameters: {
				...parameters,
				granularity: '',
				additionalFields: {},
				bulkOptions: { sharedFields: '{"granularity": "model", "propertyTypeIds": ["804"]}' },
			},
			input: units(1),
		});

		expect(lines(bulkCalls()[0])).toEqual([
			{ shared: { granularity: 'model', propertyTypeIds: ['804'] } },
			{ unlockableId: 11 },
		]);
		expect(items[0].json).toEqual({ row: 1, status: 'duplicate', taskId: 'task-1' });
	});

	// The workspace numbers its errors in the order rows finished, not
	// in the order they were sent.
	it('ties each rejected row to its input item by the identifiers it echoes', async () => {
		acceptBulk();
		const detail = {
			status: 'error',
			error: 'DPP_INVALID',
			modelIdentifier: 'FC-50ML',
			batchIdentifier: 'L2026-09',
			serialIdentifier: '000003',
			fields: { gtin: { error: 'blank', message: 'is required' } },
		};
		const invalid = { ...detail, row: 1 };
		workspace.on('GET', '/api/dpps/bulk/task-1', {
			body: {
				taskId: 'task-1',
				status: 'completed',
				createdCount: 1,
				duplicateCount: 1,
				errorCount: 1,
				errors: [invalid],
			},
		});

		const items = await runNode(node, workspace, { parameters, input: units(3) });

		expect(items.map((item) => item.json)).toEqual([
			{ row: 1, status: 'published', taskId: 'task-1' },
			{ row: 2, status: 'published', taskId: 'task-1' },
			{ row: 3, ...detail, taskId: 'task-1' },
		]);
	});

	it('marks the rows of a call unknown when the workspace lists fewer errors than it counts', async () => {
		acceptBulk();
		workspace.on('GET', '/api/dpps/bulk/task-1', {
			body: { taskId: 'task-1', status: 'completed', createdCount: 1, errorCount: 1, errors: [] },
		});

		const items = await runNode(node, workspace, { parameters, input: units(2) });

		expect(items.map((item) => item.json.status)).toEqual(['unknown', 'unknown']);
		expect(items[0].json.message).toContain('did not tie every rejected row');
	});

	it('stops naming the rows of a call the workspace stopped', async () => {
		acceptBulk();
		workspace.on('GET', '/api/dpps/bulk/task-1', {
			body: { taskId: 'task-1', status: 'failed' },
		});

		await expect(runNode(node, workspace, { parameters, input: units(2) })).rejects.toThrow(
			'The workspace stopped the passports of rows 1 to 2 (failed)',
		);
	});
});

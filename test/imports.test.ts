import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sleep, type IDataObject } from 'n8n-workflow';
import { Transpareo } from '../nodes/Transpareo/Transpareo.node';
import { FakeWorkspace } from './fake-workspace';
import { runNode } from './harness';

vi.mock('n8n-workflow', async (importOriginal) => ({
	...(await importOriginal<typeof import('n8n-workflow')>()),
	sleep: vi.fn(async () => {}),
}));

const node = new Transpareo();

const csv = 'Name,GTIN,Material\nAlign Pant,4012345000009,Nylon\n';

const sheet = {
	data: {
		data: Buffer.from(csv).toString('base64'),
		mimeType: 'text/csv',
		fileName: 'catalogue.csv',
		fileExtension: 'csv',
	},
};

const preview = {
	columns: [
		{
			header: 'Name',
			column: 'name',
			suggestedAction: 'map_to_attribute',
			coreAttribute: 'name',
			matchType: 'exact',
		},
		{
			header: 'GTIN',
			column: 'gtin',
			suggestedAction: 'map_to_attribute',
			coreAttribute: 'gtin',
			matchType: 'attribute',
		},
		{
			header: 'Material',
			column: 'material',
			suggestedAction: 'use_existing',
			typeId: '804',
			typeName: 'Material',
			matchType: 'fuzzy',
			similarity: 0.92,
		},
	],
	coreAttributes: ['name', 'gtin'],
	requiredAttributes: ['name'],
	propertyTypes: [
		{ id: '804', name: 'Material' },
		{ id: '805', name: 'Colour' },
	],
};

const run = { resource: 'import', operation: 'run', dataType: 'products' };

describe('Transpareo import Run', () => {
	let workspace: FakeWorkspace;
	let state: IDataObject;

	beforeEach(async () => {
		workspace = await new FakeWorkspace().start();
		vi.mocked(sleep).mockClear();
		state = { id: 7, dataType: 'products', status: 'fresh', totalEntries: 1, preview };
		workspace.on('GET', '/api/me', { body: { bulkItemsPerMinute: 5000 } });
		workspace.on('POST', '/api/imports', () => ({ status: 201, body: state }));
		workspace.on('PUT', '/api/imports/7/mappings', () => {
			state = mapped();
			return { body: state };
		});
		workspace.on('POST', '/api/imports/7/validate', () => {
			state = { ...state, status: 'validating' };
			return { status: 202, body: state };
		});
		workspace.on('POST', '/api/imports/7/execute', () => {
			state = { ...state, status: 'importing' };
			return { status: 202, body: state };
		});
		workspace.on('GET', '/api/imports/7', () => {
			if (state.status === 'validating') state = { ...state, status: 'validated', rowErrors: [] };
			else if (state.status === 'importing') state = { ...state, ...completed };
			return { body: state };
		});
	});

	afterEach(async () => {
		await workspace.stop();
	});

	const completed = {
		status: 'completed',
		createdCount: 1,
		updatedCount: 0,
		unchangedCount: 0,
		failedCount: 0,
		revertable: true,
	};

	// The import as the workspace answers it once mapped: without the
	// preview it shows only while fresh.
	function mapped() {
		const answer: IDataObject = { ...state, status: 'mapped' };
		delete answer.preview;
		return answer;
	}

	function request(method: string, path: string) {
		return workspace
			.apiRequests()
			.find((candidate) => candidate.method === method && candidate.path === path);
	}

	it('uploads a file, maps it as the workspace suggests, validates, imports and waits', async () => {
		const items = await runNode(node, workspace, { parameters: run, binary: [sheet] });

		const upload = request('POST', '/api/imports');
		expect(upload?.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
		expect(upload?.body).toContain('name="file"; filename="catalogue.csv"');
		expect(upload?.body).toContain(csv);
		expect(upload?.body).toMatch(/name="dataType"\r\n\r\nproducts\r\n/);
		expect(JSON.parse(request('PUT', '/api/imports/7/mappings')?.body ?? '')).toEqual({
			mappings: {
				name: { action: 'map_to_attribute', coreAttribute: 'name' },
				gtin: { action: 'map_to_attribute', coreAttribute: 'gtin' },
				material: { action: 'use_existing', typeId: '804' },
			},
		});
		expect(items.map((item) => item.json)).toEqual([
			{ id: 7, dataType: 'products', totalEntries: 1, rowErrors: [], ...completed },
		]);
		expect(items[0].pairedItem).toEqual({ item: 0 });
	});

	it('sends the input items as one JSON file, with the overrides and options asked for', async () => {
		const input = [
			{ Name: 'Align Pant', GTIN: '4012345000009', Material: 'Nylon', Note: 'x' },
			{ Name: 'Define Jacket', GTIN: '4012345000016', Material: 'Lycra', Note: 'y' },
		];
		const note = {
			header: 'Note',
			column: 'note',
			suggestedAction: 'create_new',
			matchType: 'none',
		};
		state = { ...state, preview: { ...preview, columns: [...preview.columns, note] } };

		const items = await runNode(node, workspace, {
			parameters: {
				...run,
				source: 'items',
				columnMappings: {
					mapping: [
						{ column: 'material', mapTo: 'propertyType', target: 'colour' },
						{ column: 'GTIN', mapTo: 'skip' },
					],
				},
				unmatchedColumns: 'create',
				importOptions: { backup: false, published: false, valueSeparator: ';' },
			},
			input,
		});

		const upload = request('POST', '/api/imports')?.body ?? '';
		expect(upload).toContain('filename="rows.json"');
		expect(upload).toContain(JSON.stringify(input));
		expect(upload).toMatch(/name="valueSeparator"\r\n\r\n;\r\n/);
		expect(JSON.parse(request('PUT', '/api/imports/7/mappings')?.body ?? '')).toEqual({
			mappings: {
				name: { action: 'map_to_attribute', coreAttribute: 'name' },
				gtin: { action: 'skip' },
				material: { action: 'use_existing', typeId: '805' },
				note: { action: 'create_new', typeName: 'Note' },
			},
			options: { backup: false, published: false },
		});
		expect(JSON.parse(request('POST', '/api/imports/7/execute')?.body ?? '')).toEqual({
			options: { backup: false, published: false },
		});
		expect(items).toHaveLength(1);
		expect(items[0].pairedItem).toEqual([{ item: 0 }, { item: 1 }]);
	});

	it('stops before writing anything when columns match nothing, naming them', async () => {
		const note = {
			header: 'Note',
			column: 'note',
			suggestedAction: 'create_new',
			matchType: 'none',
			sampleValues: ['x', 'y'],
		};
		state = { ...state, preview: { ...preview, columns: [...preview.columns, note] } };

		const runs = runNode(node, workspace, {
			parameters: { ...run, unmatchedColumns: 'stop' },
			binary: [sheet],
		});

		await expect(runs).rejects.toMatchObject({
			message: 'The workspace matched these columns to nothing: Note',
			description: expect.stringContaining('Note (e.g. x, y, suggested: create_new)'),
		});
		expect(request('PUT', '/api/imports/7/mappings')).toBeUndefined();
	});

	it('stops with the validation errors and imports nothing', async () => {
		workspace.on('GET', '/api/imports/7', () => {
			const rowErrors = [{ row: 2, field: 'gtin', code: 'invalid', message: 'is not a GTIN' }];
			const errorGroups = [{ key: 'gtin.invalid', message: 'GTIN is not valid', count: 1 }];
			return { body: { ...state, status: 'validated', failedCount: 1, rowErrors, errorGroups } };
		});

		const runs = runNode(node, workspace, { parameters: run, binary: [sheet] });

		await expect(runs).rejects.toMatchObject({
			message: 'The validation of import 7 refused rows: 1',
			description: 'GTIN is not valid (1)\nRow 2, gtin: is not a GTIN (invalid)',
		});
		expect(request('POST', '/api/imports/7/execute')).toBeUndefined();
	});

	it('stops before an import larger than the client may write a minute', async () => {
		state = { ...state, totalEntries: 6000 };

		const runs = runNode(node, workspace, { parameters: run, binary: [sheet] });

		await expect(runs).rejects.toThrow(
			'Import 7 holds 6000 rows, more than the 5000 a minute this client may write',
		);
		expect(request('POST', '/api/imports/7/execute')).toBeUndefined();
	});

	it('returns the import as it starts when not waiting, and maps nothing it mapped itself', async () => {
		state = mapped();

		const items = await runNode(node, workspace, {
			parameters: { ...run, waitForCompletion: false },
			binary: [sheet],
		});

		expect(items[0].json.status).toBe('importing');
		expect(request('PUT', '/api/imports/7/mappings')).toBeUndefined();
		const polls = workspace.apiRequests().filter((one) => one.path === '/api/imports/7');
		expect(polls).toHaveLength(1);
	});

	it('reads an import and reverts it by force', async () => {
		workspace.on('POST', '/api/imports/7/revert', { status: 202, body: { id: 7 } });

		await runNode(node, workspace, {
			parameters: { resource: 'import', operation: 'get', importId: '7' },
		});
		await runNode(node, workspace, {
			parameters: { resource: 'import', operation: 'revert', importId: '7', force: true },
		});

		expect(request('GET', '/api/imports/7')).toBeDefined();
		const revert = request('POST', '/api/imports/7/revert');
		expect(JSON.parse(revert?.body ?? '')).toEqual({ options: { force: true } });
	});
});

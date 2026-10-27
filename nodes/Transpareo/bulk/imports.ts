import {
	NodeOperationError,
	randomString,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type IPairedItemData,
} from 'n8n-workflow';
import { patientRequest } from '../../shared/transport';
import { compact } from '../shared/body';
import { finished } from '../shared/tasks';

// The matches the workspace resolves a column by. A column it matched
// to nothing, or only suggests creating a type for, is unmatched.
const MATCHED = ['exact', 'attribute', 'fuzzy'];

const SHOWN_ROW_ERRORS = 10;

type Column = {
	header?: string;
	column: string;
	suggestedAction?: string;
	coreAttribute?: string;
	typeId?: string;
	typeName?: string;
	matchType?: string;
	sampleValues?: string[];
};

type PropertyType = { id: string; name: string };

type Preview = { columns?: Column[]; propertyTypes?: PropertyType[] };

type Override = { column?: string; mapTo?: string; target?: string };

type Sheet = { name: string; type: string; content: Buffer };

type Run = { sheet: Sheet; pairedItem: IPairedItemData | IPairedItemData[] };

function multipart(sheet: Sheet, fields: IDataObject) {
	const boundary = `transpareo-${randomString(24)}`;
	const filename = sheet.name.replace(/"/g, '%22');
	const texts = Object.entries(fields).map(([name, value]) => {
		return `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
	});
	const fileHead = [
		`--${boundary}`,
		`Content-Disposition: form-data; name="file"; filename="${filename}"`,
		`Content-Type: ${sheet.type}`,
		'',
		'',
	].join('\r\n');
	const parts = [...texts, fileHead].map((text) => Buffer.from(text));
	const tail = Buffer.from(`\r\n--${boundary}--\r\n`);

	return {
		body: Buffer.concat([...parts, sheet.content, tail]),
		contentType: `multipart/form-data; boundary=${boundary}`,
	};
}

// One run per file an input item carries, or one for all input items
// as one JSON file.
async function runsOf(context: IExecuteFunctions): Promise<Run[]> {
	const items = context.getInputData();
	if (context.getNodeParameter('source', 0) === 'items') {
		const content = Buffer.from(JSON.stringify(items.map((item) => item.json)));
		const sheet = { name: 'rows.json', type: 'application/json', content };
		return [{ sheet, pairedItem: items.map((_, item) => ({ item })) }];
	}

	const runs: Run[] = [];
	for (let item = 0; item < items.length; item += 1) {
		const field = context.getNodeParameter('binaryPropertyName', item) as string;
		const binary = context.helpers.assertBinaryData(item, field);
		const content = await context.helpers.getBinaryDataBuffer(item, field);
		const name = binary.fileName ?? `upload.${binary.fileExtension ?? ''}`;
		const type = binary.mimeType || 'application/octet-stream';
		runs.push({ sheet: { name, type, content }, pairedItem: { item } });
	}

	return runs;
}

function suggestionOf(column: Column): IDataObject | undefined {
	if (!MATCHED.includes(column.matchType ?? '')) return undefined;

	switch (column.suggestedAction) {
		case 'map_to_attribute':
			return { action: 'map_to_attribute', coreAttribute: column.coreAttribute };
		case 'use_existing':
			return { action: 'use_existing', typeId: column.typeId };
		case 'skip':
			return { action: 'skip' };
		default:
			return undefined;
	}
}

function propertyTypeId(context: IExecuteFunctions, target: string, preview?: Preview) {
	if (/^\d+$/.test(target)) return target;

	const wanted = target.toLowerCase();
	const found = preview?.propertyTypes?.find((type) => type.name.toLowerCase() === wanted);
	if (found) return found.id;

	const description = preview
		? 'Check the name against the property types of the workspace'
		: 'The workspace mapped every column on its own and lists no property types, so name it by its ID';
	throw new NodeOperationError(context.getNode(), `No property type is named '${target}'`, {
		description,
	});
}

function overrideMapping(context: IExecuteFunctions, override: Override, preview?: Preview) {
	const target = (override.target ?? '').trim();
	switch (override.mapTo) {
		case 'skip':
			return { action: 'skip' };
		case 'propertyType':
			return { action: 'use_existing', typeId: propertyTypeId(context, target, preview) };
		case 'newPropertyType':
			return { action: 'create_new', typeName: target };
		default:
			return { action: 'map_to_attribute', coreAttribute: target };
	}
}

function unmatchedMapping(context: IExecuteFunctions, unmatched: Column[]): IDataObject {
	const policy = context.getNodeParameter('unmatchedColumns', 0) as string;
	if (policy === 'stop' && unmatched.length > 0) {
		const lines = unmatched.map((column) => {
			const samples = (column.sampleValues ?? []).slice(0, 3).join(', ');
			const suggestion = column.suggestedAction ? `, suggested: ${column.suggestedAction}` : '';
			return `${column.header ?? column.column} (e.g. ${samples}${suggestion})`;
		});
		const names = unmatched.map((column) => column.header ?? column.column).join(', ');
		const message = `The workspace matched these columns to nothing: ${names}`;
		throw new NodeOperationError(context.getNode(), message, {
			description: `${lines.join('\n')}\nMap them under Column Mappings, or set Unmatched Columns to Skip or Create Property Types.`,
		});
	}

	const entries = unmatched.map((column) => {
		const typeName = column.typeName ?? column.header ?? column.column;
		const mapping = policy === 'create' ? { action: 'create_new', typeName } : { action: 'skip' };
		return [column.column, mapping];
	});
	return Object.fromEntries(entries);
}

// The mapping to send, or undefined where the import mapped itself and
// nothing overrides it. Overrides name a column by heading or key.
function mappingsOf(context: IExecuteFunctions, imported: IDataObject): IDataObject | undefined {
	const overrides = context.getNodeParameter('columnMappings.mapping', 0, []) as Override[];
	const preview = imported.preview as Preview | undefined;
	if (imported.status !== 'fresh' && overrides.length === 0) return undefined;

	const current = (imported.mappings ?? {}) as IDataObject;
	const columns: Column[] = preview?.columns ?? Object.keys(current).map((column) => ({ column }));
	const keys = new Map<string, string>();
	for (const column of columns) {
		keys.set(column.column.toLowerCase(), column.column);
		if (column.header) keys.set(column.header.toLowerCase(), column.column);
	}

	const mappings: IDataObject = { ...current };
	for (const override of overrides) {
		const key = keys.get((override.column ?? '').trim().toLowerCase());
		if (!key) {
			const message = `The file has no column '${override.column}'`;
			throw new NodeOperationError(context.getNode(), message);
		}
		mappings[key] = overrideMapping(context, override, preview);
	}

	const unmatched: Column[] = [];
	for (const column of preview?.columns ?? []) {
		if (mappings[column.column]) continue;
		const suggestion = suggestionOf(column);
		if (suggestion) mappings[column.column] = compact(suggestion);
		else unmatched.push(column);
	}

	return { ...mappings, ...unmatchedMapping(context, unmatched) };
}

function rowErrorLine(error: IDataObject): string {
	const field = error.field ? `, ${error.field}` : '';
	const code = error.code ? ` (${error.code})` : '';
	return `Row ${error.row}${field}: ${error.message ?? ''}${code}`;
}

// Stops the node where the validation refused rows, or a step failed,
// with the causes counted and the first refused rows.
function ensureValid(context: IExecuteFunctions, answer: IDataObject, step: string) {
	const rowErrors = (answer.rowErrors ?? []) as IDataObject[];
	const failed = Number(answer.failedCount) || rowErrors.length;
	if (answer.status !== 'failed' && failed === 0) return;

	const groups = ((answer.errorGroups ?? []) as IDataObject[]).map((group) => {
		return `${group.message} (${group.count})`;
	});
	const rows = rowErrors.slice(0, SHOWN_ROW_ERRORS).map(rowErrorLine);
	const outcome = failed > 0 ? `refused rows: ${failed}` : 'failed';
	const message = `The ${step} of import ${answer.id} ${outcome}`;
	throw new NodeOperationError(context.getNode(), message, {
		description: [...groups, ...rows].join('\n'),
	});
}

// The workspace refuses to import more rows at once than the client
// may write a minute, however long the node waits.
async function ensureWithinCap(context: IExecuteFunctions, validated: IDataObject) {
	const consumer = await patientRequest.call(context, 'GET', '/me');
	const cap = Number(consumer.bulkItemsPerMinute);
	const rows = Number(validated.totalEntries);
	if (!cap || rows <= cap) return;

	const message = `Import ${validated.id} holds ${rows} rows, more than the ${cap} a minute this client may write`;
	throw new NodeOperationError(context.getNode(), message, {
		description: `Raise Bulk DPPs per minute of the API consumer in the application manager to ${rows} or more, or split the file. The workspace refuses a larger import whatever the wait.`,
	});
}

async function importOne(context: IExecuteFunctions, run: Run): Promise<IDataObject> {
	const options = context.getNodeParameter('importOptions', 0, {}) as IDataObject;
	const chosen = compact({ backup: options.backup, published: options.published });
	const runOptions = Object.keys(chosen).length > 0 ? { options: chosen } : {};
	const fields = compact({
		dataType: context.getNodeParameter('dataType', 0),
		valueSeparator: options.valueSeparator,
	});
	const upload = multipart(run.sheet, fields);
	const headers = { 'Content-Type': upload.contentType };
	const imported = await patientRequest.call(context, 'POST', '/imports', {
		body: upload.body,
		headers,
	});

	const path = `/imports/${encodeURIComponent(String(imported.id))}`;
	const mappings = mappingsOf(context, imported);
	if (mappings) {
		const body = { mappings, ...runOptions };
		await patientRequest.call(context, 'PUT', `${path}/mappings`, { body });
	}

	await patientRequest.call(context, 'POST', `${path}/validate`);
	const validated = await finished(context, path);
	ensureValid(context, validated, 'validation');
	await ensureWithinCap(context, validated);

	const execute = { body: runOptions };
	const started = await patientRequest.call(context, 'POST', `${path}/execute`, execute);
	if (!context.getNodeParameter('waitForCompletion', 0, true)) return started;

	const done = await finished(context, path);
	if (done.status === 'failed') ensureValid(context, done, 'run');
	return done;
}

// Import Run: the imports API end to end, as the application manager
// runs it: upload, map, validate, import.
export async function run(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const output: INodeExecutionData[] = [];
	for (const one of await runsOf(this)) {
		const json = await importOne(this, one);
		output.push({ json, pairedItem: one.pairedItem });
	}

	return [output];
}

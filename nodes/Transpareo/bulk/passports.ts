import {
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
} from 'n8n-workflow';
import { patientRequest } from '../../shared/transport';
import { jsonObject, newPassport } from '../shared/body';
import { finished } from '../shared/tasks';

// The ceilings of one asynchronous bulk call.
const MAX_ROWS = 50000;

const MAX_BYTES = 25 * 1024 * 1024;

const IDENTIFIERS = ['modelIdentifier', 'batchIdentifier', 'serialIdentifier'];

const REVIEW_NOTE =
	'Create Many publishes every passport it writes, and this workspace has every publish reviewed first. Create the passports with Create and ask for their publish in the application manager.';

const RESEND_NOTE =
	'The rows of earlier calls are written. Sending the same rows again is safe: a row whose passport is published comes back as duplicate.';

const UNTIED_MESSAGE =
	"The workspace did not tie every rejected row of this call to its row, so this one may be among them. Sending the call's rows again is safe: a published row comes back as duplicate.";

type Row = {
	index: number;
	line: string;
	identifiers: IDataObject;
};

// The identifiers a result echoes, from a row or the shared line,
// which take camelCase or snake_case keys.
function identifiersOf(fields: IDataObject): IDataObject {
	const pairs = IDENTIFIERS.map((name) => {
		const snake = name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
		return [name, fields[name] ?? fields[snake]];
	});
	return Object.fromEntries(pairs.filter(([, value]) => value !== undefined && value !== ''));
}

function rowsOf(context: IExecuteFunctions, shared: IDataObject): Row[] {
	const sharedIdentifiers = identifiersOf(shared);
	return context.getInputData().map((_, index) => {
		const dpp = newPassport(context, (name, fallback, options) => {
			return context.getNodeParameter(name, index, fallback, options);
		});
		const identifiers = { ...sharedIdentifiers, ...identifiersOf(dpp) };
		return { index, line: JSON.stringify(dpp), identifiers };
	});
}

// As many rows a call as the client may write a minute: the workspace
// refuses a call larger than that cap however long the node waits.
async function rowsPerCall(context: IExecuteFunctions, asked: number): Promise<number> {
	const consumer = await patientRequest.call(context, 'GET', '/me');
	const cap = Number(consumer.bulkItemsPerMinute) || MAX_ROWS;
	return Math.min(asked || cap, cap, MAX_ROWS);
}

function chunked(rows: Row[], limit: number, envelope: string): Row[][] {
	const chunks: Row[][] = [];
	let chunk: Row[] = [];
	let bytes = Buffer.byteLength(envelope);
	for (const row of rows) {
		const size = Buffer.byteLength(row.line) + 1;
		const full = chunk.length === limit || bytes + size > MAX_BYTES;
		if (full && chunk.length > 0) {
			chunks.push(chunk);
			chunk = [];
			bytes = Buffer.byteLength(envelope);
		}
		chunk.push(row);
		bytes += size;
	}
	if (chunk.length > 0) chunks.push(chunk);

	return chunks;
}

// An error the workspace echoes identifiers with belongs to a row whose
// identifiers agree: one at least equal, none different.
function agrees(row: Row, error: IDataObject): boolean {
	let matched = false;
	for (const name of IDENTIFIERS) {
		const ours = row.identifiers[name];
		const theirs = error[name];
		if (ours === undefined || theirs === undefined) continue;
		if (String(ours) !== String(theirs)) return false;
		matched = true;
	}

	return matched;
}

// What a row the workspace lists no error for came to. The status of
// a call counts its published rows, so the count tells created from
// duplicate only where the call had one kind.
function quietStatus(task: IDataObject): IDataObject {
	if (!Number(task.duplicateCount)) return { status: 'created' };
	if (!Number(task.createdCount)) return { status: 'duplicate' };
	return { status: 'published' };
}

// One result per row of a finished call. The workspace numbers its
// errors in the order the rows finished, so an error is tied to its
// row by the identifiers it echoes.
function rowResults(chunk: Row[], task: IDataObject): INodeExecutionData[] {
	const errors = (task.errors ?? []) as IDataObject[];
	const claimed = new Map<number, IDataObject>();
	let untied = Number(task.errorCount ?? 0) - errors.length;
	for (const error of errors) {
		const at = chunk.findIndex((row, index) => !claimed.has(index) && agrees(row, error));
		if (at < 0) untied += 1;
		else claimed.set(at, error);
	}
	const quiet = untied > 0 ? { status: 'unknown', message: UNTIED_MESSAGE } : quietStatus(task);

	// The row an error carries is its place in finishing order, so the
	// input row replaces it.
	return chunk.map((row, index) => {
		const json = { ...(claimed.get(index) ?? quiet), row: row.index + 1, taskId: task.taskId };
		return { json, pairedItem: { item: row.index } };
	});
}

async function send(context: IExecuteFunctions, chunk: Row[], envelope: string) {
	const lines = [envelope, ...chunk.map((row) => row.line)].filter(Boolean);
	const options = {
		body: `${lines.join('\n')}\n`,
		headers: { 'Content-Type': 'application/x-ndjson', Prefer: 'respond-async' },
		notes: { DPP_REVIEW_REQUIRED: REVIEW_NOTE },
	};

	return await patientRequest.call(context, 'POST', '/dpps/bulk', options);
}

async function results(context: IExecuteFunctions, chunk: Row[], accepted: IDataObject) {
	const taskId = encodeURIComponent(String(accepted.taskId));
	const task = await finished(context, `/dpps/bulk/${taskId}`);
	if (task.status === 'completed') return rowResults(chunk, task);

	const first = chunk[0].index + 1;
	const last = chunk[chunk.length - 1].index + 1;
	const message = `The workspace stopped the passports of rows ${first} to ${last} (${task.status})`;
	throw new NodeOperationError(context.getNode(), message, { description: RESEND_NOTE });
}

function callItem(chunk: Row[], accepted: IDataObject): INodeExecutionData {
	const json = {
		...accepted,
		firstRow: chunk[0].index + 1,
		lastRow: chunk[chunk.length - 1].index + 1,
	};
	return { json, pairedItem: chunk.map((row) => ({ item: row.index })) };
}

// Passport Create Many: every input item one passport, sent in as few
// asynchronous bulk calls as the client's per-minute cap allows.
export async function createMany(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const options = this.getNodeParameter('bulkOptions', 0, {}) as IDataObject;
	const wait = this.getNodeParameter('waitForCompletion', 0, true) as boolean;
	const shared = jsonObject(this, options.sharedFields, 'Shared Fields (JSON)') ?? {};
	const envelope = Object.keys(shared).length > 0 ? JSON.stringify({ shared }) : '';

	const rows = rowsOf(this, shared);
	const limit = await rowsPerCall(this, Number(options.rowsPerCall ?? 0));
	const output: INodeExecutionData[] = [];
	for (const chunk of chunked(rows, limit, envelope)) {
		const accepted = await send(this, chunk, envelope);
		if (wait) output.push(...(await results(this, chunk, accepted)));
		else output.push(callItem(chunk, accepted));
	}

	return [output];
}

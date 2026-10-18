import {
	NodeOperationError,
	type IDataObject,
	type INodeExecutionData,
	type IPollFunctions,
} from 'n8n-workflow';
import { apiRequest } from '../shared/transport';

const PER_PAGE = 100;
const FEED_LIMIT = 500;
const MAX_PAGES = 10_000;

// The next poll starts this long before the current one did. Clock skew
// between n8n and the workspace, and a write committed while a page was
// read, fall inside it; what was emitted inside it is skipped by key.
const OVERLAP_MS = 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type RecordWatch = {
	path: string;
	rootProperty: string;
	stamp: 'createdAt' | 'updatedAt';
};

type ListAnswer = {
	body: IDataObject;
	headers: IDataObject;
};

type FeedAnswer = {
	events?: IDataObject[];
	nextCursor?: string | null;
};

const QUERY = {
	createdAt: { sort: '-created_at', since: 'created_since' },
	updatedAt: { sort: '-updated_at', since: 'updated_since' },
};

function asItems(records: IDataObject[]): INodeExecutionData[][] | null {
	if (records.length === 0) return null;
	return [records.map((json) => ({ json }))];
}

function keyOf(record: IDataObject, stamp: string): string {
	return `${record.id}@${record[stamp]}`;
}

async function listPage(context: IPollFunctions, watch: RecordWatch, qs: IDataObject) {
	const answer = (await apiRequest.call(context, 'GET', watch.path, {
		qs,
		fullResponse: true,
	})) as ListAnswer;
	const records = (answer.body?.[watch.rootProperty] ?? []) as IDataObject[];
	const more = /rel="next"/.test(String(answer.headers?.link ?? ''));

	// A list without the time would ignore the bound too and hand over
	// every record at every poll, so polling stops instead.
	const undated = records.some((record) => Number.isNaN(Date.parse(String(record[watch.stamp]))));
	if (undated) {
		throw new NodeOperationError(
			context.getNode(),
			'The workspace does not say when its records changed',
			{
				description: `Polling reads '${watch.stamp}' on every record, which this workspace's API does not answer yet. The Transpareo Trigger works without it.`,
			},
		);
	}

	return { records, more };
}

// Records created or changed since the last poll. The list is read
// newest first through every page, then emitted oldest first.
export async function pollRecords(context: IPollFunctions, watch: RecordWatch) {
	const state = context.getWorkflowStaticData('node');
	const query = QUERY[watch.stamp];
	const startedAt = Date.now();

	if (context.getMode() === 'manual') {
		const { records } = await listPage(context, watch, { sort: query.sort, per_page: 1 });
		return asItems(records.slice(0, 1));
	}

	if (!state.since) {
		state.since = new Date(startedAt).toISOString();
		state.seen = [];
		return null;
	}

	const seen = new Set((state.seen ?? []) as string[]);
	const fetched: IDataObject[] = [];
	for (let page = 1, more = true; more; page++) {
		if (page > MAX_PAGES) {
			throw new NodeOperationError(context.getNode(), 'More changes than one poll can read', {
				description: 'Poll more often, or narrow the trigger',
			});
		}
		const qs = { sort: query.sort, [query.since]: state.since, per_page: PER_PAGE, page };
		const result = await listPage(context, watch, qs);
		fetched.push(...result.records);
		more = result.more;
	}

	const nextSince = startedAt - OVERLAP_MS;
	const fresh = new Map<string, IDataObject>();
	for (const record of fetched) {
		const key = keyOf(record, watch.stamp);
		if (!seen.has(key) && !fresh.has(key)) fresh.set(key, record);
	}
	const inOverlap = fetched.filter(
		(record) => Date.parse(String(record[watch.stamp])) >= nextSince,
	);

	state.since = new Date(nextSince).toISOString();
	state.seen = [...new Set(inOverlap.map((record) => keyOf(record, watch.stamp)))];
	return asItems([...fresh.values()].reverse());
}

export type FeedWatch = {
	types: string[];
	passportCode: string;
};

async function feedPage(context: IPollFunctions, watch: FeedWatch, since: string) {
	const qs: IDataObject = { since, limit: FEED_LIMIT };
	if (watch.types.length > 0) qs.types = watch.types.join(',');
	if (watch.passportCode) qs.dppCode = watch.passportCode;
	return (await apiRequest.call(context, 'GET', '/events', { qs })) as FeedAnswer;
}

// The passport event feed after the stored cursor, read on while it
// answers full pages. The cursor moves only once every page arrived, so
// a failed page leaves the events for the next poll.
export async function pollFeed(context: IPollFunctions, watch: FeedWatch) {
	const state = context.getWorkflowStaticData('node');

	if (context.getMode() === 'manual') {
		const since = new Date(Date.now() - DAY_MS).toISOString();
		const answer = await feedPage(context, watch, since);
		return asItems((answer.events ?? []).slice(-1));
	}

	if (!state.cursor) {
		state.cursor = new Date().toISOString();
		return null;
	}

	const events: IDataObject[] = [];
	let cursor = String(state.cursor);
	for (let page = 1, full = true; full && page <= MAX_PAGES; page++) {
		const answer = await feedPage(context, watch, cursor);
		const batch = answer.events ?? [];
		events.push(...batch);
		cursor = answer.nextCursor ?? cursor;
		full = batch.length === FEED_LIMIT;
	}

	state.cursor = cursor;
	return asItems(events);
}

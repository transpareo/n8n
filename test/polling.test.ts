import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IDataObject, IHttpRequestOptions, IPollFunctions } from 'n8n-workflow';
import { TranspareoPollingTrigger } from '../nodes/TranspareoPollingTrigger/TranspareoPollingTrigger.node';
import { fakeContext, type Reply } from './context';

const trigger = new TranspareoPollingTrigger();
const NOW = '2026-10-18T12:00:00.000Z';

function pollContext(options: {
	parameters: IDataObject;
	staticData?: IDataObject;
	mode?: string;
	reply?: Reply;
}) {
	const fake = fakeContext(options);
	return { ...fake, poll: fake.context as unknown as IPollFunctions };
}

function page(body: IDataObject, next?: number) {
	const headers: IDataObject = {};
	if (next) headers.link = `<https://acme.example.com/api/products?page=${next}>; rel="next"`;
	return { body, headers };
}

function requests(mock: { mock: { calls: [string, IHttpRequestOptions][] } }) {
	return mock.mock.calls.map((call) => call[1]);
}

describe('Transpareo Polling Trigger on records', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(NOW));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('starts watching on its first activation without replaying what exists', async () => {
		const { poll, httpRequestWithAuthentication, staticData } = pollContext({
			parameters: { event: 'productUpdated' },
		});

		expect(await trigger.poll.call(poll)).toBeNull();
		expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
		expect(staticData).toEqual({ since: NOW, seen: [] });
	});

	it('answers the newest record when the trigger is tested by hand', async () => {
		const product = { id: 11, updatedAt: '2026-10-18T11:59:00Z' };
		const { poll, httpRequestWithAuthentication, staticData } = pollContext({
			parameters: { event: 'productUpdated' },
			mode: 'manual',
			reply: () => page({ products: [product] }),
		});

		expect(await trigger.poll.call(poll)).toEqual([[{ json: product }]]);
		const [request] = requests(httpRequestWithAuthentication);
		expect(request.url).toBe('https://acme.example.com/api/products');
		expect(request.qs).toEqual({ sort: '-updated_at', per_page: 1 });
		expect(staticData).toEqual({});
	});

	it('emits the records changed since the last poll, oldest first, across every page', async () => {
		const { poll, httpRequestWithAuthentication, staticData } = pollContext({
			parameters: { event: 'productUpdated' },
			staticData: { since: '2026-10-18T11:50:00.000Z', seen: [] },
			reply: (request) => {
				if (request.qs?.page === 2)
					return page({ products: [{ id: 1, updatedAt: '2026-10-18T11:55:00Z' }] });
				const products = [
					{ id: 3, updatedAt: '2026-10-18T11:59:30Z' },
					{ id: 2, updatedAt: '2026-10-18T11:58:00Z' },
				];
				return page({ products }, 2);
			},
		});

		const result = await trigger.poll.call(poll);

		expect(result?.[0].map((item) => item.json.id)).toEqual([1, 2, 3]);
		const sent = requests(httpRequestWithAuthentication);
		expect(sent.map((request) => request.qs)).toEqual([
			{ sort: '-updated_at', updated_since: '2026-10-18T11:50:00.000Z', per_page: 100, page: 1 },
			{ sort: '-updated_at', updated_since: '2026-10-18T11:50:00.000Z', per_page: 100, page: 2 },
		]);
		expect(staticData).toEqual({
			since: '2026-10-18T11:59:00.000Z',
			seen: ['3@2026-10-18T11:59:30Z'],
		});
	});

	it('skips a record it emitted inside the overlap and emits it again once it changes', async () => {
		const { poll, staticData } = pollContext({
			parameters: { event: 'productUpdated' },
			staticData: { since: '2026-10-18T11:59:00.000Z', seen: ['3@2026-10-18T11:59:30Z'] },
			reply: () => {
				const products = [
					{ id: 4, updatedAt: '2026-10-18T11:59:50Z' },
					{ id: 3, updatedAt: '2026-10-18T11:59:30Z' },
				];
				return page({ products });
			},
		});

		const result = await trigger.poll.call(poll);

		expect(result?.[0].map((item) => item.json.id)).toEqual([4]);
		expect(staticData.seen).toEqual(['4@2026-10-18T11:59:50Z', '3@2026-10-18T11:59:30Z']);
	});

	it('emits nothing when nothing changed', async () => {
		const { poll, staticData } = pollContext({
			parameters: { event: 'componentCreated' },
			staticData: { since: '2026-10-18T11:59:00.000Z', seen: [] },
			reply: () => page({ components: [] }),
		});

		expect(await trigger.poll.call(poll)).toBeNull();
		expect(staticData.since).toBe('2026-10-18T11:59:00.000Z');
	});

	it('stops at a workspace whose list does not say when a record changed', async () => {
		const { poll, staticData } = pollContext({
			parameters: { event: 'productUpdated' },
			staticData: { since: '2026-10-18T11:50:00.000Z', seen: [] },
			reply: () => page({ products: [{ id: 3, name: 'Face Cream' }] }),
		});

		await expect(trigger.poll.call(poll)).rejects.toThrow(
			'The workspace does not say when its records changed',
		);
		expect(staticData.since).toBe('2026-10-18T11:50:00.000Z');
	});

	it('watches new passports by their creation time', async () => {
		const { poll, httpRequestWithAuthentication } = pollContext({
			parameters: { event: 'passportCreated' },
			staticData: { since: '2026-10-18T11:50:00.000Z', seen: [] },
			reply: () => page({ dpps: [{ id: 14, createdAt: '2026-10-18T11:51:00Z' }] }),
		});

		const result = await trigger.poll.call(poll);

		expect(result?.[0].map((item) => item.json.id)).toEqual([14]);
		const [request] = requests(httpRequestWithAuthentication);
		expect(request.url).toBe('https://acme.example.com/api/dpps');
		expect(request.qs).toMatchObject({
			sort: '-created_at',
			created_since: '2026-10-18T11:50:00.000Z',
		});
	});
});

describe('Transpareo Polling Trigger on passport events', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(NOW));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('starts the feed at the time of its first activation', async () => {
		const { poll, httpRequestWithAuthentication, staticData } = pollContext({
			parameters: { event: 'passportEvent', eventTypes: [], passportCode: '' },
		});

		expect(await trigger.poll.call(poll)).toBeNull();
		expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
		expect(staticData).toEqual({ cursor: NOW });
	});

	it('follows the cursor and keeps the next one', async () => {
		const events = [
			{ id: 'e1', eventType: 'published', dppCode: 'A1B2C3D4E' },
			{ id: 'e2', eventType: 'voided', dppCode: 'A1B2C3D4E' },
		];
		const { poll, httpRequestWithAuthentication, staticData } = pollContext({
			parameters: {
				event: 'passportEvent',
				eventTypes: ['published', 'voided'],
				passportCode: 'A1B2C3D4E',
			},
			staticData: { cursor: 'e0' },
			reply: () => ({ events, nextCursor: 'e2' }),
		});

		const result = await trigger.poll.call(poll);

		expect(result?.[0].map((item) => item.json.id)).toEqual(['e1', 'e2']);
		const [request] = requests(httpRequestWithAuthentication);
		expect(request.url).toBe('https://acme.example.com/api/events');
		expect(request.qs).toEqual({
			since: 'e0',
			limit: 500,
			types: 'published,voided',
			dppCode: 'A1B2C3D4E',
		});
		expect(staticData).toEqual({ cursor: 'e2' });
	});

	it('reads on while the feed answers full pages', async () => {
		const full = Array.from({ length: 500 }, (_, index) => ({ id: `a${index}` }));
		const { poll, httpRequestWithAuthentication, staticData } = pollContext({
			parameters: { event: 'passportEvent', eventTypes: [], passportCode: '' },
			staticData: { cursor: 'e0' },
			reply: (request) => {
				if (request.qs?.since === 'e0') return { events: full, nextCursor: 'a499' };
				return { events: [{ id: 'b0' }], nextCursor: 'b0' };
			},
		});

		const result = await trigger.poll.call(poll);

		expect(result?.[0]).toHaveLength(501);
		expect(requests(httpRequestWithAuthentication).map((request) => request.qs?.since)).toEqual([
			'e0',
			'a499',
		]);
		expect(staticData).toEqual({ cursor: 'b0' });
	});

	it('keeps the cursor where it was when a later page fails', async () => {
		const full = Array.from({ length: 500 }, (_, index) => ({ id: `a${index}` }));
		const { poll, staticData } = pollContext({
			parameters: { event: 'passportEvent', eventTypes: [], passportCode: '' },
			staticData: { cursor: 'e0' },
			reply: (request) => {
				if (request.qs?.since === 'e0') return { events: full, nextCursor: 'a499' };
				throw new Error('Request failed with status code 503');
			},
		});

		await expect(trigger.poll.call(poll)).rejects.toThrow('503');
		expect(staticData).toEqual({ cursor: 'e0' });
	});

	it('answers an event of the past day when tested by hand', async () => {
		const events = [{ id: 'e1' }, { id: 'e2' }];
		const { poll, httpRequestWithAuthentication, staticData } = pollContext({
			parameters: { event: 'passportEvent', eventTypes: [], passportCode: '' },
			mode: 'manual',
			reply: () => ({ events, nextCursor: 'e2' }),
		});

		expect(await trigger.poll.call(poll)).toEqual([[{ json: { id: 'e2' } }]]);
		expect(requests(httpRequestWithAuthentication)[0].qs?.since).toBe('2026-10-17T12:00:00.000Z');
		expect(staticData).toEqual({});
	});
});

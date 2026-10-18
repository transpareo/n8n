import { describe, expect, inject, it, vi } from 'vitest';
import type {
	IDataObject,
	IHookFunctions,
	IHttpRequestOptions,
	IPollFunctions,
} from 'n8n-workflow';
import { TranspareoApi } from '../../credentials/TranspareoApi.credentials';
import { Transpareo } from '../../nodes/Transpareo/Transpareo.node';
import { TranspareoPollingTrigger } from '../../nodes/TranspareoPollingTrigger/TranspareoPollingTrigger.node';
import { TranspareoTrigger } from '../../nodes/TranspareoTrigger/TranspareoTrigger.node';
import { runNode } from '../harness';

declare module 'vitest' {
	export interface ProvidedContext {
		workspace: { host: string; clientId: string; clientSecret: string };
	}
}

// Runs the nodes against a real workspace. Skipped unless a consumer
// with product_access, dpp_read, dpp_write, dpp_history, webhook_access
// and task_access is configured, as for the command line's own checks.
const env = inject('workspace');
const configured = env.host !== '' && env.clientId !== '' && env.clientSecret !== '';
const origin = env.host.startsWith('http') ? env.host.replace(/\/+$/, '') : `https://${env.host}`;
const credentials = {
	workspaceUrl: origin,
	clientId: env.clientId,
	clientSecret: env.clientSecret,
};

async function send(options: IHttpRequestOptions, token?: string) {
	const url = new URL(options.url);
	for (const [key, value] of Object.entries(options.qs ?? {})) {
		if (value !== undefined) url.searchParams.set(key, String(value));
	}
	const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
	if (token) headers.Authorization = `Bearer ${token}`;
	let body = options.body as string | undefined;
	if (body && typeof body !== 'string') {
		body = JSON.stringify(body);
		headers['Content-Type'] = 'application/json';
	}
	const response = await fetch(url, { method: options.method ?? 'GET', headers, body });
	const text = await response.text();
	const parsed = text ? JSON.parse(text) : {};
	if (!response.ok) throw Object.assign(new Error(text), { httpCode: String(response.status) });
	if (options.returnFullResponse)
		return { body: parsed, headers: Object.fromEntries(response.headers) };
	return parsed;
}

let token: string | undefined;

async function authenticated(_type: string, options: IHttpRequestOptions) {
	if (!token) {
		const helper = { helpers: { httpRequest: (request: IHttpRequestOptions) => send(request) } };
		const minted = await new TranspareoApi().preAuthentication.call(helper as never, credentials);
		token = String(minted.accessToken);
	}
	return await send(options, token);
}

function liveContext(parameters: IDataObject, staticData: IDataObject = {}) {
	const hookUrl = `https://example.com/n8n-e2e/${Date.now()}`;
	return {
		getCredentials: async () => credentials,
		getNodeParameter: (name: string, fallback?: unknown) =>
			name in parameters ? parameters[name] : fallback,
		getNode: () => ({ name: 'Transpareo', type: 'transpareo', typeVersion: 1 }),
		getWorkflowStaticData: () => staticData,
		getMode: () => 'trigger',
		getWorkflow: () => ({ id: 'e2e', name: `e2e ${Date.now()}`, active: true }),
		getNodeWebhookUrl: () => hookUrl,
		logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		helpers: { httpRequestWithAuthentication: authenticated },
	};
}

describe.skipIf(!configured)('against a real workspace', () => {
	const node = new Transpareo();

	it('lists products recently updated first, each with its time', async () => {
		const items = await runNode(
			node,
			{ origin },
			{
				parameters: {
					resource: 'product',
					operation: 'getAll',
					returnAll: false,
					limit: 3,
					filters: { sort: '-updated_at', updatedSince: '2020-01-01T00:00:00Z' },
				},
				credentials,
			},
		);

		const times = items.map((item) => Date.parse(String(item.json.updatedAt)));
		expect(times.every((time) => !Number.isNaN(time))).toBe(true);
		expect([...times].sort((a, b) => b - a)).toEqual(times);
	});

	it('gets a product it listed and what a passport of it needs', async () => {
		const [listed] = await runNode(
			node,
			{ origin },
			{
				parameters: { resource: 'product', operation: 'getAll', returnAll: false, limit: 1 },
				credentials,
			},
		);
		const id = String(listed.json.id);

		const [product] = await runNode(
			node,
			{ origin },
			{
				parameters: {
					resource: 'product',
					operation: 'get',
					product: { __rl: true, mode: 'id', value: id },
				},
				credentials,
			},
		);
		expect(product.json.id).toBe(listed.json.id);

		const [requirements] = await runNode(
			node,
			{ origin },
			{
				parameters: {
					resource: 'passport',
					operation: 'getRequirements',
					product: { __rl: true, mode: 'id', value: id },
					requirementsGranularity: 'model',
				},
				credentials,
			},
		);
		expect(requirements.json).toHaveProperty('identifiers');
	});

	it('finds a passport by the code a webhook names', async () => {
		const [listed] = await runNode(
			node,
			{ origin },
			{
				parameters: { resource: 'passport', operation: 'getAll', returnAll: false, limit: 1 },
				credentials,
			},
		);
		if (!listed) return;

		const [passport] = await runNode(
			node,
			{ origin },
			{
				parameters: {
					resource: 'passport',
					operation: 'get',
					passport: { __rl: true, mode: 'code', value: String(listed.json.code) },
				},
				credentials,
			},
		);
		expect(passport.json.id).toBe(listed.json.id);
	});

	it('reads the tasks the credential asked for and whom it may ask', async () => {
		await runNode(
			node,
			{ origin },
			{
				parameters: {
					resource: 'task',
					operation: 'getAll',
					list: 'requested',
					returnAll: false,
					limit: 5,
				},
				credentials,
			},
		);
		const assignees = await runNode(
			node,
			{ origin },
			{
				parameters: { resource: 'task', operation: 'getAssignees', term: '' },
				credentials,
			},
		);
		for (const assignee of assignees)
			expect(String(assignee.json.key)).toMatch(/^(User|AccessGroup):\d+$/);
	});

	it('subscribes a webhook on activation and removes it on deactivation', async () => {
		const trigger = new TranspareoTrigger();
		const staticData: IDataObject = {};
		const hooks = liveContext(
			{ events: ['published'], passportCodes: [] },
			staticData,
		) as unknown as IHookFunctions;

		expect(await trigger.webhookMethods.default.create.call(hooks)).toBe(true);
		expect(String(staticData.secret)).toMatch(/^[0-9a-f]{64}$/);
		const id = staticData.webhookId;

		expect(await trigger.webhookMethods.default.checkExists.call(hooks)).toBe(true);
		expect(await trigger.webhookMethods.default.delete.call(hooks)).toBe(true);
		expect(staticData.webhookId).toBeUndefined();
		await expect(authenticated('', { url: `${origin}/api/webhooks/${id}` })).rejects.toMatchObject({
			httpCode: '404',
		});
	});

	it('polls products and the passport event feed', async () => {
		const trigger = new TranspareoPollingTrigger();
		const records: IDataObject = { since: '2020-01-01T00:00:00.000Z', seen: [] };
		const poll = liveContext({ event: 'productUpdated' }, records) as unknown as IPollFunctions;
		await trigger.poll.call(poll);
		expect(Date.parse(String(records.since))).toBeGreaterThan(Date.parse('2026-01-01'));

		const feed: IDataObject = { cursor: new Date(Date.now() - 86_400_000).toISOString() };
		const events = liveContext({ event: 'passportEvent', eventTypes: [], passportCode: '' }, feed);
		await trigger.poll.call(events as unknown as IPollFunctions);
		expect(feed.cursor).toBeTruthy();
	});
});

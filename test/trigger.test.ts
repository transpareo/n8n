import { createHmac } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import type { IHookFunctions, IWebhookFunctions } from 'n8n-workflow';
import { TranspareoTrigger } from '../nodes/TranspareoTrigger/TranspareoTrigger.node';
import { verifySignature } from '../nodes/TranspareoTrigger/signature';
import { fakeContext } from './context';

const trigger = new TranspareoTrigger();
const methods = trigger.webhookMethods.default;
const HOOK_URL = 'https://n8n.example.com/webhook/abc';
const SECRET = 'a'.repeat(64);

function hookContext(options: Parameters<typeof fakeContext>[0]) {
	const fake = fakeContext({
		...options,
		extra: { getNodeWebhookUrl: () => HOOK_URL, ...options.extra },
	});
	return { ...fake, hooks: fake.context as unknown as IHookFunctions };
}

function apiError(status: number) {
	return Object.assign(new Error(`Request failed with status ${status}`), {
		httpCode: String(status),
	});
}

function signed(body: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
	const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
	return `t=${timestamp},v1=${digest}`;
}

function webhookContext(options: { body: object; signature?: string; rawBody?: Buffer | null }) {
	const text = JSON.stringify(options.body);
	const rawBody = options.rawBody === undefined ? Buffer.from(text) : options.rawBody;
	const response = { status: vi.fn(), send: vi.fn(), end: vi.fn() };
	response.status.mockReturnValue(response);
	response.send.mockReturnValue(response);
	const { context } = fakeContext({
		staticData: { webhookId: 7, secret: SECRET },
		extra: {
			getRequestObject: () => ({ rawBody, body: options.body }),
			getHeaderData: () => ({ 'x-transpareo-signature': options.signature ?? signed(text) }),
			getBodyData: () => options.body,
			getResponseObject: () => response,
		},
	});
	return { context: context as unknown as IWebhookFunctions, response };
}

describe('Transpareo Trigger subscription', () => {
	it('subscribes this webhook to the passport events picked, and keeps the id and secret', async () => {
		const { hooks, httpRequestWithAuthentication, staticData } = hookContext({
			parameters: { events: ['published', 'voided'], passportCodes: ['A1B2C3D4E'] },
			reply: () => ({ id: 7, secret: SECRET }),
		});

		expect(await methods.create.call(hooks)).toBe(true);

		const request = httpRequestWithAuthentication.mock.calls[0][1];
		expect(request.method).toBe('POST');
		expect(request.url).toBe('https://acme.example.com/api/webhooks');
		expect(request.body).toEqual({
			webhook: {
				name: 'n8n: Order fulfilment',
				url: HOOK_URL,
				eventTypes: ['published', 'voided'],
				resourceScopeDppCodes: ['A1B2C3D4E'],
			},
		});
		expect(staticData).toEqual({ webhookId: 7, secret: SECRET });
	});

	it('explains a refused address and points to the polling trigger', async () => {
		const answer = {
			error: 'WEBHOOK_INVALID',
			message: 'The webhook is invalid.',
			fields: { url: { error: 'WEBHOOK_URL_INVALID', message: 'must be https' } },
		};
		const refusal = Object.assign(apiError(422), { context: { data: answer } });
		const { hooks } = hookContext({
			parameters: { events: [], passportCodes: [] },
			reply: () => {
				throw refusal;
			},
		});

		const create = methods.create.call(hooks);

		await expect(create).rejects.toMatchObject({
			message: 'The webhook is invalid. (WEBHOOK_INVALID)',
			description: expect.stringContaining('url: must be https (WEBHOOK_URL_INVALID)'),
		});
		await expect(create).rejects.toMatchObject({
			description: expect.stringContaining('Transpareo Polling Trigger'),
		});
	});

	it('knows of no subscription before the first activation', async () => {
		const { hooks, httpRequestWithAuthentication } = hookContext({});

		expect(await methods.checkExists.call(hooks)).toBe(false);
		expect(httpRequestWithAuthentication).not.toHaveBeenCalled();
	});

	it('keeps a subscription that is active and points at this webhook', async () => {
		const { hooks } = hookContext({
			staticData: { webhookId: 7, secret: SECRET },
			reply: () => ({ id: 7, url: HOOK_URL, active: true }),
		});

		expect(await methods.checkExists.call(hooks)).toBe(true);
	});

	it('replaces a subscription the failures switched off', async () => {
		const { hooks, httpRequestWithAuthentication, staticData } = hookContext({
			staticData: { webhookId: 7, secret: SECRET },
			reply: (request) => (request.method === 'GET' ? { id: 7, url: HOOK_URL, active: false } : {}),
		});

		expect(await methods.checkExists.call(hooks)).toBe(false);
		const methodsCalled = httpRequestWithAuthentication.mock.calls.map((call) => call[1].method);
		expect(methodsCalled).toEqual(['GET', 'DELETE']);
		expect(staticData).toEqual({});
	});

	it('forgets a subscription the workspace no longer has', async () => {
		const { hooks, staticData } = hookContext({
			staticData: { webhookId: 7, secret: SECRET },
			reply: () => {
				throw apiError(404);
			},
		});

		expect(await methods.checkExists.call(hooks)).toBe(false);
		expect(staticData).toEqual({});
	});

	it('unsubscribes on deactivation', async () => {
		const { hooks, httpRequestWithAuthentication, staticData } = hookContext({
			staticData: { webhookId: 7, secret: SECRET },
			reply: () => ({ status: 'OK' }),
		});

		expect(await methods.delete.call(hooks)).toBe(true);
		const request = httpRequestWithAuthentication.mock.calls[0][1];
		expect(request.method).toBe('DELETE');
		expect(request.url).toBe('https://acme.example.com/api/webhooks/7');
		expect(staticData).toEqual({});
	});

	it('counts a subscription already gone as unsubscribed', async () => {
		const { hooks, staticData } = hookContext({
			staticData: { webhookId: 7, secret: SECRET },
			reply: () => {
				throw apiError(404);
			},
		});

		expect(await methods.delete.call(hooks)).toBe(true);
		expect(staticData).toEqual({});
	});

	it('reports any other failure to unsubscribe', async () => {
		const { hooks } = hookContext({
			staticData: { webhookId: 7, secret: SECRET },
			reply: () => {
				throw apiError(500);
			},
		});

		await expect(methods.delete.call(hooks)).rejects.toThrow();
	});
});

describe('Transpareo Trigger deliveries', () => {
	const delivery = {
		id: '68bea2f8a3c1d40011e5f0b2',
		type: 'published',
		dpp_code: 'A1B2C3D4E',
		occurred_at: '2026-10-18T09:12:44Z',
		data: { version: 3 },
	};

	it('runs the workflow with a delivery whose signature holds', async () => {
		const { context } = webhookContext({ body: delivery });

		const result = await trigger.webhook.call(context);

		expect(result.workflowData).toEqual([[{ json: delivery }]]);
	});

	it('answers a test ping without running the workflow', async () => {
		const ping = {
			id: 'ping-1',
			type: 'ping',
			dpp_code: null,
			occurred_at: '2026-10-18T09:12:44Z',
			data: {},
		};
		const { context } = webhookContext({ body: ping });

		const result = await trigger.webhook.call(context);

		expect(result.workflowData).toBeUndefined();
		expect(result.webhookResponse).toEqual({ received: true });
	});

	it('refuses a delivery signed with another secret', async () => {
		const text = JSON.stringify(delivery);
		const { context, response } = webhookContext({
			body: delivery,
			signature: signed(text, 'b'.repeat(64)),
		});

		const result = await trigger.webhook.call(context);

		expect(result).toEqual({ noWebhookResponse: true });
		expect(response.status).toHaveBeenCalledWith(401);
	});

	it('refuses a delivery without the raw body to check', async () => {
		const { context, response } = webhookContext({ body: delivery, rawBody: null });

		const result = await trigger.webhook.call(context);

		expect(result).toEqual({ noWebhookResponse: true });
		expect(response.status).toHaveBeenCalledWith(401);
	});
});

describe('Transpareo webhook signature', () => {
	const body = Buffer.from('{"id":"1"}');
	const now = 1_760_000_000;

	it('holds for the secret, the timestamp and the raw body', () => {
		const header = signed(body.toString(), SECRET, now);
		expect(verifySignature(SECRET, header, body, now + 10)).toBe(true);
	});

	it('fails for a body changed on the way', () => {
		const header = signed(body.toString(), SECRET, now);
		expect(verifySignature(SECRET, header, Buffer.from('{"id":"2"}'), now)).toBe(false);
	});

	it('fails for a timestamp more than five minutes away', () => {
		const header = signed(body.toString(), SECRET, now);
		expect(verifySignature(SECRET, header, body, now + 301)).toBe(false);
	});

	it('fails for a header that is not the expected shape', () => {
		expect(verifySignature(SECRET, 'v1=abc', body, now)).toBe(false);
		expect(verifySignature(SECRET, undefined, body, now)).toBe(false);
		expect(verifySignature('', signed(body.toString(), '', now), body, now)).toBe(false);
	});
});

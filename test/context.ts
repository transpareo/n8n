import { vi } from 'vitest';
import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';

export type Reply = (options: IHttpRequestOptions) => unknown;

// The part of n8n's function context the package's own code reads:
// credentials, parameters, static data and the authenticated request.
export function fakeContext(options: {
	parameters?: IDataObject;
	reply?: Reply;
	staticData?: IDataObject;
	mode?: string;
	extra?: IDataObject;
}) {
	const parameters = options.parameters ?? {};
	const staticData = options.staticData ?? {};
	const reply = options.reply ?? (() => ({}));
	const httpRequestWithAuthentication = vi.fn(
		async (_type: string, request: IHttpRequestOptions) => {
			return reply(request);
		},
	);
	const context = {
		getCredentials: vi.fn(async () => ({
			workspaceUrl: 'https://acme.example.com/',
			clientId: 'client-1',
			clientSecret: 'secret-1',
		})),
		getNodeParameter: vi.fn((name: string, fallback?: unknown) => {
			return name in parameters ? parameters[name] : fallback;
		}),
		getNode: () => ({ name: 'Transpareo', type: 'transpareo', typeVersion: 1 }),
		getWorkflowStaticData: () => staticData,
		getMode: () => options.mode ?? 'trigger',
		getWorkflow: () => ({ id: 'workflow-1', name: 'Order fulfilment', active: true }),
		logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		helpers: { httpRequestWithAuthentication },
		...options.extra,
	};
	return { context, httpRequestWithAuthentication, staticData };
}

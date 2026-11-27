import {
	NodeApiError,
	sleep,
	type IDataObject,
	type IExecuteFunctions,
	type IExecuteSingleFunctions,
	type IHookFunctions,
	type IHttpRequestMethods,
	type IHttpRequestOptions,
	type ILoadOptionsFunctions,
	type IN8nHttpFullResponse,
	type INode,
	type INodeExecutionData,
	type IPollFunctions,
	type JsonObject,
} from 'n8n-workflow';
import { workspaceOrigin } from './workspace';

export const CREDENTIAL_TYPE = 'transpareoOAuth2Api';

type Context = IExecuteSingleFunctions | IHookFunctions | ILoadOptionsFunctions | IPollFunctions;

type RequestOptions = {
	qs?: IDataObject;
	body?: IDataObject | string | Buffer;
	headers?: IDataObject;
	fullResponse?: boolean;
};

type PatientOptions = RequestOptions & {
	// A note of the node's own under the workspace's message, by the
	// code the workspace refused with.
	notes?: Record<string, string>;
};

// A 429 asking for a wait this long or shorter, as the per-minute item
// cap does, is waited out. The hourly request cap asks for an hour,
// which no workflow should sit through.
const LONGEST_WAIT_SECONDS = 120;

const ATTEMPTS = 5;

type Field = {
	error?: string;
	message?: string;
};

// The error answer of the workspace API.
type Answer = {
	error?: string;
	message?: string;
	hint?: string;
	docsUrl?: string;
	fields?: Record<string, Field>;
};

// The HTTP status of a failed request, as n8n's request helpers report it.
export function statusOf(error: unknown): number | undefined {
	const failure = error as { httpCode?: string; response?: { status?: number } };
	return Number(failure.httpCode ?? failure.response?.status) || undefined;
}

// The lines under the headline: each field the workspace names with
// its message and code, then its hint, a note of the node's own and
// the reference.
function details(answer: Answer, note?: string): string {
	const fields = Object.entries(answer.fields ?? {}).map(([name, field]) => {
		const code = field.error ? ` (${field.error})` : '';
		return `${name}: ${field.message ?? ''}${code}`;
	});
	const reference = answer.docsUrl ? `Reference: ${answer.docsUrl}` : undefined;

	return [...fields, answer.hint, note, reference].filter(Boolean).join('\n');
}

function answerOf(body: unknown): Answer {
	return (typeof body === 'object' && body !== null ? body : {}) as Answer;
}

// The workspace's own message and code, such as "Reading these records
// needs the dpp_read permission. (DPP_FORBIDDEN)", where it sent one.
export function headline(body: unknown): string | undefined {
	const answer = answerOf(body);
	if (!answer.message) return undefined;

	const code = answer.error ? ` (${answer.error})` : '';
	return `${answer.message}${code}`;
}

// A failed answer as the error n8n shows and an AI agent reads: the
// workspace's own message and code as the headline, the details
// below, the answer itself in the error's data. An answer without a
// message keeps n8n's wording for its status.
export function refusal(node: INode, status: number, body: unknown, note?: string) {
	const answer = answerOf(body);
	const httpCode = String(status);
	const message = headline(answer);
	if (!message) {
		return new NodeApiError(node, answer as JsonObject, { httpCode, description: note });
	}

	const error = new NodeApiError(node, answer as JsonObject, {
		httpCode,
		message,
		description: details(answer, note),
	});
	error.context.data = answer;
	return error;
}

// The same for an error n8n's request helper raised, which holds the
// answer in its data. An error without a status, such as a refused
// connection, stays as it is.
export function refusalOf(node: INode, error: unknown, note?: string) {
	const status = statusOf(error);
	if (!status) return error;

	const body = (error as { context?: { data?: unknown } }).context?.data;
	return refusal(node, status, body, note);
}

// The first step after every request of the action node. Its requests
// answer every status but 401 (see its requestDefaults), so a failed
// answer arrives here. Without a step of its own, n8n turns an answer
// that is a list into one item per entry; this keeps that.
export async function raiseRefusal(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	if (response.statusCode >= 400) {
		throw refusal(this.getNode(), response.statusCode, response.body);
	}
	if (!Array.isArray(response.body)) return items;

	return response.body.map((json) => ({ json: json as IDataObject }));
}

// One authenticated call to the workspace API, for the code the
// declarative routing cannot express: list searches, option lists,
// webhook subscriptions and polls.
export async function apiRequest(
	this: Context,
	method: IHttpRequestMethods,
	path: string,
	options: RequestOptions = {},
) {
	const credentials = await this.getCredentials(CREDENTIAL_TYPE);
	const request: IHttpRequestOptions = {
		method,
		url: `${workspaceOrigin(credentials.workspaceUrl)}/api${path}`,
		headers: { Accept: 'application/json' },
		qs: options.qs,
		body: options.body,
		json: true,
		returnFullResponse: options.fullResponse,
	};

	try {
		return await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_TYPE, request);
	} catch (error) {
		throw refusalOf(this.getNode(), error);
	}
}

// One call of a custom operation with the whole answer. Every status
// but 401 comes back, as the action node's requests do, so a 401 still
// throws and n8n renews the token and sends again.
export async function apiResponse(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	path: string,
	options: RequestOptions = {},
): Promise<IN8nHttpFullResponse> {
	const credentials = await this.getCredentials(CREDENTIAL_TYPE);
	const request: IHttpRequestOptions = {
		method,
		url: `${workspaceOrigin(credentials.workspaceUrl)}/api${path}`,
		headers: { Accept: 'application/json', ...options.headers },
		qs: options.qs,
		body: options.body,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: { ignore: true, except: [401] },
	};

	try {
		return await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_TYPE, request);
	} catch (error) {
		throw refusalOf(this.getNode(), error);
	}
}

// The seconds a 429 asks to wait, where it asks for a short wait.
function shortWait(response: IN8nHttpFullResponse): number | undefined {
	if (response.statusCode !== 429) return undefined;

	const seconds = Number(response.headers['retry-after']);
	if (!Number.isFinite(seconds) || seconds > LONGEST_WAIT_SECONDS) return undefined;
	return Math.max(seconds, 1);
}

// A call of a bulk operation. A 429 that asks for a short wait is
// waited out and sent again; any other failed answer raises the
// workspace's own message.
export async function patientRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	path: string,
	options: PatientOptions = {},
): Promise<IDataObject> {
	for (let attempt = 1; ; attempt += 1) {
		const response = await apiResponse.call(this, method, path, options);
		const wait = shortWait(response);
		if (wait && attempt < ATTEMPTS) {
			await sleep(wait * 1000, this.getExecutionCancelSignal());
			continue;
		}
		if (response.statusCode < 400) return response.body as IDataObject;

		const code = answerOf(response.body).error ?? '';
		const note = options.notes?.[code];
		throw refusal(this.getNode(), response.statusCode, response.body, note);
	}
}

import {
	NodeApiError,
	type IDataObject,
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

export const CREDENTIAL_TYPE = 'transpareoApi';

type Context = IExecuteSingleFunctions | IHookFunctions | ILoadOptionsFunctions | IPollFunctions;

type RequestOptions = {
	qs?: IDataObject;
	body?: IDataObject;
	fullResponse?: boolean;
};

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

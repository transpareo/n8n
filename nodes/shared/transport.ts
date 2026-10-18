import type {
	IDataObject,
	IExecuteSingleFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IPollFunctions,
} from 'n8n-workflow';
import { workspaceOrigin } from './workspace';

export const CREDENTIAL_TYPE = 'transpareoApi';

type Context = IExecuteSingleFunctions | IHookFunctions | ILoadOptionsFunctions | IPollFunctions;

type RequestOptions = {
	qs?: IDataObject;
	body?: IDataObject;
	fullResponse?: boolean;
};

// The HTTP status of a failed request, as n8n's request helpers report it.
export function statusOf(error: unknown): number | undefined {
	const failure = error as { httpCode?: string; response?: { status?: number } };
	return Number(failure.httpCode ?? failure.response?.status) || undefined;
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

	return await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL_TYPE, request);
}

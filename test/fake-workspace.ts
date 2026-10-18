import nock from 'nock';

// Kept apart from the engine runner in harness.ts: importing nock patches
// Node's sockets for the whole process, which breaks real TLS connections
// of the suite that runs against a live workspace.

export type RecordedRequest = {
	method: string;
	path: string;
	query: Record<string, string>;
	headers: Record<string, string | string[] | undefined>;
	body: string;
};

export type Answer = {
	status?: number;
	body?: unknown;
	headers?: Record<string, string>;
};

type Route = {
	method: string;
	path: string;
	answer: (request: RecordedRequest) => Answer;
};

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// A workspace API that never leaves the process: every request to its
// origin is recorded and answered from the routes a test declares, the
// token endpoint included.
export class FakeWorkspace {
	requests: RecordedRequest[] = [];

	private routes: Route[] = [];

	tokenRequests = 0;

	readonly origin: string = 'https://acme.example.com';

	on(method: string, path: string, answer: Answer | ((request: RecordedRequest) => Answer)) {
		const respond = typeof answer === 'function' ? answer : () => answer;
		this.routes.unshift({ method, path, answer: respond });
		return this;
	}

	apiRequests(): RecordedRequest[] {
		return this.requests.filter((request) => request.path !== '/api/oauth/token');
	}

	async start() {
		this.on('POST', '/api/oauth/token', () => {
			this.tokenRequests += 1;
			const body = { access_token: `token-${this.tokenRequests}`, token_type: 'Bearer' };
			return { body };
		});
		nock.disableNetConnect();
		const scope = nock(this.origin).persist();
		const answer = this.answer.bind(this);
		for (const method of METHODS) {
			scope.intercept(/.*/, method).reply(function (uri, body) {
				return answer(method, uri, body, this.req.headers);
			});
		}
		return this;
	}

	async stop() {
		nock.cleanAll();
		nock.enableNetConnect();
	}

	private answer(
		method: string,
		uri: string,
		body: unknown,
		headers: RecordedRequest['headers'],
	): [number, string, Record<string, string>] {
		const url = new URL(uri, this.origin);
		const request: RecordedRequest = {
			method,
			path: url.pathname,
			query: Object.fromEntries(url.searchParams.entries()),
			headers,
			body: typeof body === 'string' ? body : JSON.stringify(body ?? ''),
		};
		this.requests.push(request);
		const route = this.routes.find(
			(candidate) => candidate.method === request.method && candidate.path === request.path,
		);
		const answer = route ? route.answer(request) : { status: 404, body: { error: 'NOT_FOUND' } };
		const answerHeaders = { 'Content-Type': 'application/json', ...answer.headers };
		const text = answer.body === undefined ? '' : JSON.stringify(answer.body);
		return [answer.status ?? 200, text, answerHeaders];
	}
}

import nock from 'nock';
import { ExecutionLifecycleHooks, WorkflowExecute } from 'n8n-core';
import {
	ICredentialsHelper,
	Workflow,
	type ICredentialDataDecryptedObject,
	type ICredentialType,
	type IDataObject,
	type IHttpRequestHelper,
	type IHttpRequestOptions,
	type INode,
	type INodeCredentialsDetails,
	type INodeExecutionData,
	type INodeType,
	type INodeTypes,
	type IRun,
	type IWorkflowExecuteAdditionalData,
	type NodeParameterValueType,
} from 'n8n-workflow';
import { TranspareoApi } from '../credentials/TranspareoApi.credentials';

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

// Credentials as n8n hands them to a node: the stored values, the token
// minted by the credential's own preAuthentication, and a refresh on 401.
class TestCredentialsHelper extends ICredentialsHelper {
	constructor(
		private readonly types: Record<string, ICredentialType>,
		private readonly stored: Record<string, ICredentialDataDecryptedObject>,
	) {
		super();
	}

	getParentTypes(): string[] {
		return [];
	}

	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		typeName: string,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		const authenticate = this.types[typeName].authenticate;
		if (typeof authenticate !== 'function') return requestOptions;
		return await authenticate(credentials, requestOptions);
	}

	async preAuthentication(
		helpers: IHttpRequestHelper,
		credentials: ICredentialDataDecryptedObject,
		typeName: string,
		_node: INode,
		credentialsExpired: boolean,
	): Promise<ICredentialDataDecryptedObject | undefined> {
		const type = this.types[typeName];
		const expirable = type.properties.find((property) => property.typeOptions?.expirable);
		if (!type.preAuthentication || !expirable) return undefined;
		if (credentials[expirable.name] && !credentialsExpired) return undefined;

		const output = await type.preAuthentication.call(helpers, credentials);
		const updated = { ...credentials, ...output } as ICredentialDataDecryptedObject;
		this.stored[typeName] = updated;
		return updated;
	}

	async runPreAuthentication(): Promise<ICredentialDataDecryptedObject | undefined> {
		return undefined;
	}

	async getDecrypted(
		_additionalData: IWorkflowExecuteAdditionalData,
		_nodeCredentials: INodeCredentialsDetails,
		type: string,
	): Promise<ICredentialDataDecryptedObject> {
		return { ...this.stored[type] };
	}

	async getCredentials(): Promise<never> {
		throw new Error('Not used by these tests');
	}

	async updateCredentials(): Promise<void> {}

	async updateCredentialsOauthTokenData(): Promise<void> {}

	getCredentialsProperties() {
		return [];
	}

	isCredentialUsableByNode(): boolean {
		return true;
	}
}

export type RunOptions = {
	parameters: Record<string, NodeParameterValueType | object>;
	credentials?: ICredentialDataDecryptedObject;
	input?: IDataObject[];
};

// Runs one node of the package through n8n's own workflow engine, so the
// declarative routing is executed as n8n executes it.
export async function runNode(
	nodeType: INodeType,
	workspace: Pick<FakeWorkspace, 'origin'>,
	options: RunOptions,
): Promise<INodeExecutionData[]> {
	const credentialType = new TranspareoApi();
	const stored = {
		[credentialType.name]: {
			workspaceUrl: workspace.origin,
			clientId: 'client-1',
			clientSecret: 'secret-1',
			accessToken: '',
			issuedFor: '',
			...options.credentials,
		},
	};
	const credentialsHelper = new TestCredentialsHelper(
		{ [credentialType.name]: credentialType },
		stored,
	);

	const description = nodeType.description;
	const node: INode = {
		id: 'node-1',
		name: 'Node',
		type: description.name,
		typeVersion: Array.isArray(description.version)
			? description.version[description.version.length - 1]
			: description.version,
		position: [0, 0],
		parameters: options.parameters as INode['parameters'],
		credentials: { [credentialType.name]: { id: '1', name: 'Transpareo' } },
	};
	const nodeTypes: INodeTypes = {
		getByName: () => nodeType,
		getByNameAndVersion: () => nodeType,
		getKnownTypes: () => ({}),
	};
	const workflow = new Workflow({
		id: 'workflow-1',
		name: 'Test workflow',
		nodes: [node],
		connections: {},
		active: false,
		nodeTypes,
		staticData: {},
	});
	const workflowData = {
		id: 'workflow-1',
		name: 'Test workflow',
		nodes: [node],
		connections: {},
		active: false,
		settings: {},
		createdAt: new Date(),
		updatedAt: new Date(),
	};
	const hooks = new ExecutionLifecycleHooks('manual', 'execution-1', workflowData as never);
	const additionalData = {
		credentialsHelper,
		hooks,
		executionId: 'execution-1',
		currentNodeExecutionIndex: 0,
		restApiUrl: 'http://localhost/rest',
		instanceBaseUrl: 'http://localhost',
		formBaseUrl: 'http://localhost/form',
		formWaitingBaseUrl: 'http://localhost/form-waiting',
		formTestBaseUrl: 'http://localhost/form-test',
		webhookBaseUrl: 'http://localhost/webhook',
		webhookWaitingBaseUrl: 'http://localhost/webhook-waiting',
		webhookTestBaseUrl: 'http://localhost/webhook-test',
		mcpBaseUrl: 'http://localhost/mcp',
		mcpTestBaseUrl: 'http://localhost/mcp-test',
		variables: {},
		logAiEvent: () => {},
	} as unknown as IWorkflowExecuteAdditionalData;

	const input = (options.input ?? [{}]).map((json) => ({ json }));
	const execute = new WorkflowExecute(additionalData, 'manual');
	const run: IRun = await execute.run({
		workflow,
		startNode: node,
		pinData: undefined,
		triggerToStartFrom: { name: node.name, data: inputTaskData(input) },
	} as never);

	const result = run.data.resultData;
	if (result.error) throw result.error;
	const taskData = result.runData[node.name]?.[0];
	if (taskData?.error) throw taskData.error;
	return taskData?.data?.main?.[0] ?? [];
}

function inputTaskData(items: INodeExecutionData[]) {
	return {
		startTime: 0,
		executionTime: 0,
		executionIndex: 0,
		source: [],
		data: { main: [items] },
	};
}

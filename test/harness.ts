import { ExecutionLifecycleHooks, WorkflowExecute } from 'n8n-core';
import {
	ICredentialsHelper,
	NodeHelpers,
	Workflow,
	type ICredentialDataDecryptedObject,
	type ICredentialType,
	type IDataObject,
	type IHttpRequestOptions,
	type INode,
	type INodeCredentialsDetails,
	type INodeExecutionData,
	type INodeParameters,
	type INodeType,
	type INodeTypes,
	type IRun,
	type IWorkflowExecuteAdditionalData,
	type NodeParameterValueType,
} from 'n8n-workflow';
import { TranspareoOAuth2Api } from '../credentials/TranspareoOAuth2Api.credentials';

// The node and node type n8n's credentials helper resolves credential
// expressions with, outside of any workflow.
const credentialNode: INode = {
	id: 'credentials',
	name: 'Credentials',
	type: 'mock',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

const credentialNodeType = { description: { properties: [] } } as unknown as INodeType;

const credentialNodeTypes: INodeTypes = {
	getByName: () => credentialNodeType,
	getByNameAndVersion: () => credentialNodeType,
	getKnownTypes: () => ({}),
};

// The stored values of a credential as n8n's credentials helper hands
// them on: the defaults of the type's own fields filled in, then its
// expressions resolved with the values as `$self`. The fields of
// oAuth2Api the type leaves alone are not filled in; n8n-core reads
// them as unset.
export async function resolveCredentials(
	type: ICredentialType,
	stored: ICredentialDataDecryptedObject,
): Promise<ICredentialDataDecryptedObject> {
	const values = stored as INodeParameters;
	const data = NodeHelpers.getNodeParameters(type.properties, values, true, false, null, null);
	const self = { ...data, oauthTokenData: stored.oauthTokenData };
	const workflow = new Workflow({
		nodes: [credentialNode],
		connections: {},
		active: false,
		nodeTypes: credentialNodeTypes,
	});

	await workflow.expression.acquireIsolate();
	try {
		const resolved = workflow.expression.getComplexParameterValue(
			credentialNode,
			self as INodeParameters,
			'manual',
			{},
			undefined,
			undefined,
			self,
		);
		return resolved as ICredentialDataDecryptedObject;
	} finally {
		await workflow.expression.releaseIsolate();
	}
}

// Credentials as n8n hands them to a node of an OAuth2 type: n8n-core
// fetches the token, stores it here and fetches another on a 401.
class TestCredentialsHelper extends ICredentialsHelper {
	constructor(
		private readonly types: Record<string, ICredentialType>,
		private readonly stored: Record<string, ICredentialDataDecryptedObject>,
	) {
		super();
	}

	getParentTypes(name: string): string[] {
		return this.types[name]?.extends ?? [];
	}

	async authenticate(
		_credentials: ICredentialDataDecryptedObject,
		_typeName: string,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		return requestOptions;
	}

	async preAuthentication(): Promise<ICredentialDataDecryptedObject | undefined> {
		return undefined;
	}

	async runPreAuthentication(): Promise<ICredentialDataDecryptedObject | undefined> {
		return undefined;
	}

	// A raw read is the stored values as they are, which n8n-core asks
	// for to see whether another run renewed the token meanwhile.
	async getDecrypted(
		_additionalData: IWorkflowExecuteAdditionalData,
		_nodeCredentials: INodeCredentialsDetails,
		type: string,
		_mode: unknown,
		_executeData: unknown,
		raw?: boolean,
	): Promise<ICredentialDataDecryptedObject> {
		const stored = { ...this.stored[type] };
		if (raw) return stored;
		return await resolveCredentials(this.types[type], stored);
	}

	async getCredentials(): Promise<never> {
		throw new Error('Not used by these tests');
	}

	async updateCredentials(): Promise<void> {}

	async updateCredentialsOauthTokenData(
		_nodeCredentials: INodeCredentialsDetails,
		type: string,
		data: ICredentialDataDecryptedObject,
	): Promise<void> {
		this.stored[type] = { ...this.stored[type], oauthTokenData: data.oauthTokenData };
	}

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
	binary?: Array<INodeExecutionData['binary']>;
	settings?: Pick<INode, 'onError'>;
};

// Runs one node of the package through n8n's own workflow engine, so the
// declarative routing is executed as n8n executes it.
export async function runNode(
	nodeType: INodeType,
	workspace: { origin: string },
	options: RunOptions,
): Promise<INodeExecutionData[]> {
	const credentialType = new TranspareoOAuth2Api();
	const stored = {
		[credentialType.name]: {
			workspaceUrl: workspace.origin,
			clientId: 'client-1',
			clientSecret: 'secret-1',
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
		...options.settings,
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

	const input = (options.input ?? [{}]).map((json, index) => {
		const binary = options.binary?.[index];
		return binary ? { json, binary } : { json };
	});
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

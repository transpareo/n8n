import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IExecuteFunctions,
	type INode,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';
import { credentialTest } from '../shared/connection';
import { createMany } from './bulk/passports';
import { listSearch, loadOptions } from './methods';
import { componentDescription } from './resources/component';
import { lotDescription } from './resources/lot';
import { passportDescription } from './resources/passport';
import { productDescription } from './resources/product';
import { taskDescription } from './resources/task';

type CustomOperation = (this: IExecuteFunctions) => Promise<INodeExecutionData[][]>;

// The node's own error as it is, any other wrapped as n8n shows it.
function nodeError(node: INode, error: unknown) {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) return error;
	return new NodeOperationError(node, error as Error);
}

// A node set to continue on fail hands a failed run on as one item
// naming the error, paired with every input item, as the routing does
// for its own operations.
function continuing(operation: CustomOperation): CustomOperation {
	return async function (this: IExecuteFunctions) {
		try {
			return await operation.call(this);
		} catch (error) {
			if (!this.continueOnFail()) throw nodeError(this.getNode(), error);
			const pairedItem = this.getInputData().map((_, item) => ({ item }));
			return [[{ json: { error: (error as Error).message }, pairedItem }]];
		}
	};
}

export class Transpareo implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Transpareo',
		name: 'transpareo',
		icon: {
			light: 'file:../../icons/transpareo.svg',
			dark: 'file:../../icons/transpareo.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Work with the products, components, Digital Product Passports, lots and tasks of a Transpareo workspace',
		defaults: {
			name: 'Transpareo',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'transpareoApi',
				required: true,
				testedBy: 'transpareoApiTest',
			},
		],
		// Every answer but a 401 reaches the operations, which raise a
		// failed one with the workspace's own message (`raiseRefusal`).
		// A 401 still throws, so n8n renews the token and sends again.
		requestDefaults: {
			baseURL: '={{$credentials.workspaceUrl.trim().replace(/\\/+$/, "")}}/api',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			ignoreHttpStatusErrors: { ignore: true, except: [401] },
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Component',
						value: 'component',
					},
					{
						name: 'Lot',
						value: 'lot',
					},
					{
						name: 'Passport',
						value: 'passport',
					},
					{
						name: 'Product',
						value: 'product',
					},
					{
						name: 'Task',
						value: 'task',
					},
				],
				default: 'product',
			},
			...productDescription,
			...componentDescription,
			...passportDescription,
			...lotDescription,
			...taskDescription,
		],
	};

	methods = {
		credentialTest,
		listSearch,
		loadOptions,
	};

	// The operations that read every input item at once, which the
	// declarative routing, one request per item, cannot express.
	customOperations = {
		passport: { createMany: continuing(createMany) },
	};
}

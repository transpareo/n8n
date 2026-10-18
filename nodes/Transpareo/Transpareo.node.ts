import { NodeConnectionTypes, type INodeType, type INodeTypeDescription } from 'n8n-workflow';
import { listSearch, loadOptions } from './methods';
import { componentDescription } from './resources/component';
import { lotDescription } from './resources/lot';
import { passportDescription } from './resources/passport';
import { productDescription } from './resources/product';
import { taskDescription } from './resources/task';

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
			},
		],
		requestDefaults: {
			baseURL: '={{$credentials.workspaceUrl.trim().replace(/\\/+$/, "")}}/api',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
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
		listSearch,
		loadOptions,
	};
}

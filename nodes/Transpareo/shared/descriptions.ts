import type { IDisplayOptions, INodeProperties, INodePropertyOptions } from 'n8n-workflow';

export function showFor(resource: string, operations?: string[]): IDisplayOptions {
	const show: IDisplayOptions['show'] = { resource: [resource] };
	if (operations) show.operation = operations;
	return { show };
}

export function operationProperty(
	resource: string,
	options: INodePropertyOptions[],
	defaultOperation: string,
): INodeProperties {
	return {
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: showFor(resource),
		options,
		default: defaultOperation,
	};
}

type LocatorOptions = {
	name: string;
	displayName: string;
	resource: string;
	operations: string[];
	searchListMethod: string;
	byCode?: boolean;
	description?: string;
};

// A single record picked from a searchable list or named by its id, as
// n8n's UX guidelines ask for every field that selects one item.
export function locator(options: LocatorOptions): INodeProperties {
	return {
		displayName: options.displayName,
		name: options.name,
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: options.description,
		displayOptions: showFor(options.resource, options.operations),
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: `Select a ${options.displayName.toLowerCase()}...`,
				typeOptions: {
					searchListMethod: options.searchListMethod,
					searchable: true,
				},
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 11',
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '^[0-9]+$',
							errorMessage: 'An ID is a number',
						},
					},
				],
			},
			...(options.byCode
				? [
						{
							displayName: 'By Code',
							name: 'code',
							type: 'string' as const,
							placeholder: 'e.g. A1B2C3D4E',
						},
					]
				: []),
		],
	};
}

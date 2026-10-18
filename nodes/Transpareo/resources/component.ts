import type { INodeProperties } from 'n8n-workflow';
import { componentBody } from '../shared/body';
import { locator, operationProperty, showFor } from '../shared/descriptions';
import {
	filtersProperty,
	listOperation,
	listProperties,
	termFilter,
	timeFilters,
} from '../shared/listing';

const resource = 'component';

const mpn: INodeProperties = {
	displayName: 'Article Number (MPN)',
	name: 'mpn',
	type: 'string',
	default: '',
	description: 'The article number (Manufacturer Part Number) the maker gives the component',
};

const propertiesJson: INodeProperties = {
	displayName: 'Properties (JSON)',
	name: 'properties',
	type: 'json',
	default: '{}',
	description:
		'Property changes keyed by property type ID: "new" adds values, "existing" changes values by property ID, an empty value removes one. Get a component to read the IDs.',
};

const templateIds: INodeProperties = {
	displayName: 'Template Component IDs',
	name: 'templateIds',
	type: 'string',
	typeOptions: { multipleValues: true, multipleValueButtonText: 'Add Template' },
	default: [],
	description:
		'The components this one inherits properties from, in order. The list replaces the current one.',
};

const writeRouting = { send: { preSend: [componentBody] } };

export const componentDescription: INodeProperties[] = [
	operationProperty(
		resource,
		[
			{
				name: 'Create',
				value: 'create',
				action: 'Create a component',
				description: 'Create a new component',
				routing: {
					request: { method: 'POST', url: '/components' },
					...writeRouting,
				},
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a component',
				description: 'Retrieve a component with its properties and citations',
				routing: {
					request: { method: 'GET', url: '=/components/{{$parameter.component}}' },
				},
			},
			listOperation('/components', 'components', 'components'),
			{
				name: 'Update',
				value: 'update',
				action: 'Update a component',
				description:
					'Update the name, the article number, the properties or the templates of a component',
				routing: {
					request: { method: 'PUT', url: '=/components/{{$parameter.component}}' },
					...writeRouting,
				},
			},
		],
		'get',
	),
	locator({
		name: 'component',
		displayName: 'Component',
		resource,
		operations: ['get', 'update'],
		searchListMethod: 'searchComponents',
	}),
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor(resource, ['create']),
		description: 'The name of the component, unique across the workspace',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: showFor(resource, ['create']),
		default: {},
		options: [mpn, propertiesJson, templateIds],
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: showFor(resource, ['update']),
		default: {},
		options: [
			mpn,
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'The name of the component, unique across the workspace',
			},
			propertiesJson,
			templateIds,
		],
	},
	...listProperties(resource),
	filtersProperty(resource, [termFilter('components'), ...timeFilters]),
];

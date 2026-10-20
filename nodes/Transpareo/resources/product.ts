import type { INodeProperties } from 'n8n-workflow';
import { productBody } from '../shared/body';
import { locator, operationProperty, showFor } from '../shared/descriptions';
import {
	filtersProperty,
	listOperation,
	listProperties,
	termFilter,
	timeFilters,
} from '../shared/listing';

const resource = 'product';

const brandName: INodeProperties = {
	displayName: 'Brand Name',
	name: 'brandName',
	type: 'string',
	default: '',
	description:
		"The brand of the product. A name no brand carries yet creates the brand. A variant takes its parent's brand when this is empty.",
};

const listInRow =
	'A row typed by hand is one name. An expression in a row gives several: an array, or a text with one name per line or between commas.';

const componentNames: INodeProperties = {
	displayName: 'Component Names',
	name: 'componentNames',
	type: 'string',
	typeOptions: { multipleValues: true, multipleValueButtonText: 'Add Component' },
	default: [],
	description: `The components of the product in order, by name. A name no component carries yet creates the component. On an update the list replaces the one the product has. ${listInRow}`,
};

const parentId: INodeProperties = {
	displayName: 'Variant Of (Product ID)',
	name: 'parentId',
	type: 'number',
	default: 0,
	description:
		'The product the new one is a variant of. A variant starts as a copy of it and follows its later changes, so it needs a name alone.',
};

const gtin: INodeProperties = {
	displayName: 'GTIN',
	name: 'gtin',
	type: 'string',
	default: '',
	description: 'The Global Trade Item Number of the product',
};

const categoryIds: INodeProperties = {
	displayName: 'Category Names or IDs',
	name: 'categoryIds',
	type: 'multiOptions',
	typeOptions: { loadOptionsMethod: 'getProductCategories' },
	default: [],
	description:
		'The categories of the product. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
};

const properties: INodeProperties = {
	displayName: 'Properties',
	name: 'properties',
	type: 'fixedCollection',
	placeholder: 'Add Property',
	typeOptions: { multipleValues: true },
	displayOptions: showFor(resource, ['create', 'update']),
	default: {},
	description:
		'Values of the property types the workspace defines. Several rows of one type give it several values. A type named here is replaced; a type left out keeps its values.',
	options: [
		{
			displayName: 'Property',
			name: 'property',
			values: [
				{
					displayName: 'Property Name or ID',
					name: 'propertyTypeId',
					type: 'options',
					typeOptions: { loadOptionsMethod: 'getProductPropertyTypes' },
					default: '',
					description:
						'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				},
				{
					displayName: 'Value',
					name: 'value',
					type: 'string',
					default: '',
				},
			],
		},
	],
};

const writeRouting = { send: { preSend: [productBody] } };

export const productDescription: INodeProperties[] = [
	operationProperty(
		resource,
		[
			{
				name: 'Create',
				value: 'create',
				action: 'Create a product',
				description: 'Create a new product',
				routing: {
					request: { method: 'POST', url: '/products' },
					...writeRouting,
				},
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a product',
				description: 'Retrieve a product with its brand, components, properties and categories',
				routing: {
					request: { method: 'GET', url: '=/products/{{$parameter.product}}' },
				},
			},
			listOperation('/products', 'products', 'products'),
			{
				name: 'Update',
				value: 'update',
				action: 'Update a product',
				description: 'Update the fields of a product',
				routing: {
					request: { method: 'PUT', url: '=/products/{{$parameter.product}}' },
					...writeRouting,
				},
			},
		],
		'get',
	),
	locator({
		name: 'product',
		displayName: 'Product',
		resource,
		operations: ['get', 'update'],
		searchListMethod: 'searchProducts',
	}),
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor(resource, ['create']),
		description: 'The name of the product',
	},
	{ ...brandName, displayOptions: showFor(resource, ['create']) },
	{
		...componentNames,
		required: true,
		displayOptions: showFor(resource, ['create']),
		description: `The components of the product in order, by name, one at least. A name no component carries yet creates the component. A variant takes the components of its parent and needs none. ${listInRow}`,
	},
	properties,
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: showFor(resource, ['create']),
		default: {},
		options: [categoryIds, gtin, parentId],
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: showFor(resource, ['update']),
		default: {},
		options: [
			brandName,
			categoryIds,
			componentNames,
			gtin,
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'The name of the product',
			},
		],
	},
	...listProperties(resource),
	filtersProperty(resource, [
		{
			displayName: 'Brand Name or ID',
			name: 'brandId',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getBrands' },
			default: '',
			description:
				'Keep only the products of this brand. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			routing: { send: { type: 'query', property: 'brand_id' } },
		},
		termFilter('products'),
		...timeFilters,
	]),
];

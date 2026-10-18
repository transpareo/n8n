import type { INodeProperties } from 'n8n-workflow';
import { locator, operationProperty } from '../shared/descriptions';
import { filtersProperty, listOperation, listProperties, timeFilters } from '../shared/listing';

const resource = 'lot';

export const lotDescription: INodeProperties[] = [
	operationProperty(
		resource,
		[
			{
				name: 'Get',
				value: 'get',
				action: 'Get a lot',
				description: 'Retrieve a lot with the number of passports issued against it',
				routing: {
					request: { method: 'GET', url: '=/lots/{{$parameter.lot}}' },
				},
			},
			listOperation('/lots', 'lots', 'lots'),
		],
		'get',
	),
	{
		...locator({
			name: 'lot',
			displayName: 'Lot',
			resource,
			operations: ['get'],
			searchListMethod: 'searchLots',
		}),
		description: 'A lot is created with the first batch or item passport that names it',
	},
	...listProperties(resource),
	filtersProperty(resource, [
		{
			displayName: 'Lot Identifier',
			name: 'identifier',
			type: 'string',
			default: '',
			description:
				'Keep only the lot with this identifier, the value a passport carries as its lot',
			routing: { send: { type: 'query', property: 'identifier' } },
		},
		{
			displayName: 'Product ID',
			name: 'productId',
			type: 'number',
			default: 0,
			description: 'Keep only the lots of this product',
			routing: { send: { type: 'query', property: 'product_id' } },
		},
		...timeFilters,
	]),
];

import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import { showFor } from './descriptions';

const MAX_PER_PAGE = 500;

// The list answers name the next page in `Link: <...>; rel="next"`, the
// header the API guide asks a client to follow. n8n evaluates the request
// before the first call too, when there is no answer yet, so the first
// call keeps the address it was given.
const nextPageExists = '={{ /rel="next"/.test($response.headers?.link ?? "") }}';
const nextPageUrl =
	'={{ ($response.headers?.link ?? "").match(/<([^>]+)>;\\s*rel="next"/)?.[1] ?? $request.url }}';

// A time a person picked in the date picker, in the workflow's time
// zone unless it names its own, as the UTC time the API reads.
export const utcTime = '={{ DateTime.fromISO($value, { zone: $now.zoneName }).toUTC().toISO() }}';

export function listOperation(
	path: string,
	rootProperty: string,
	label: string,
): INodePropertyOptions {
	return {
		name: 'Get Many',
		value: 'getAll',
		action: `Get many ${label}`,
		description: `Retrieve a list of ${label}`,
		routing: {
			request: {
				method: 'GET',
				url: path,
			},
			output: {
				postReceive: [
					{
						type: 'rootProperty',
						properties: { property: rootProperty },
					},
				],
			},
		},
	};
}

export function listProperties(resource: string): INodeProperties[] {
	const displayOptions = showFor(resource, ['getAll']);
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			displayOptions,
			default: false,
			description: 'Whether to return all results or only up to a given limit',
			routing: {
				send: {
					paginate: '={{ $value }}',
					type: 'query',
					property: 'per_page',
					value: '100',
				},
				operations: {
					pagination: {
						type: 'generic',
						properties: {
							continue: nextPageExists,
							request: {
								url: nextPageUrl,
							},
						},
					},
				},
			},
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			displayOptions: {
				show: { ...displayOptions.show, returnAll: [false] },
			},
			typeOptions: { minValue: 1, maxValue: MAX_PER_PAGE },
			default: 50,
			description: 'Max number of results to return',
			routing: {
				send: {
					type: 'query',
					property: 'per_page',
				},
				output: {
					maxResults: '={{$value}}',
				},
			},
		},
	];
}

// The filters every list a workflow polls takes besides its own.
export const timeFilters: INodeProperties[] = [
	{
		displayName: 'Created Since',
		name: 'createdSince',
		type: 'dateTime',
		default: '',
		description: 'Keep only the records created at or after this time',
		routing: {
			send: { type: 'query', property: 'created_since', value: utcTime },
		},
	},
	{
		displayName: 'Sort',
		name: 'sort',
		type: 'options',
		options: [
			{
				name: 'Newest First',
				value: '-created_at',
				description: 'The most recently created records first',
			},
			{
				name: 'Recently Updated First',
				value: '-updated_at',
				description: 'The most recently changed records first',
			},
		],
		default: '-created_at',
		description: 'The order of the list. Without it the list keeps its own order.',
		routing: {
			send: { type: 'query', property: 'sort' },
		},
	},
	{
		displayName: 'Updated Since',
		name: 'updatedSince',
		type: 'dateTime',
		default: '',
		description: 'Keep only the records changed at or after this time',
		routing: {
			send: { type: 'query', property: 'updated_since', value: utcTime },
		},
	},
];

export function termFilter(label: string): INodeProperties {
	return {
		displayName: 'Search Term',
		name: 'term',
		type: 'string',
		default: '',
		description: `Keep only the ${label} matching these words`,
		routing: {
			send: { type: 'query', property: 'term' },
		},
	};
}

export function filtersProperty(resource: string, options: INodeProperties[]): INodeProperties {
	const sorted = [...options].sort((a, b) => a.displayName.localeCompare(b.displayName));
	return {
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		displayOptions: showFor(resource, ['getAll']),
		default: {},
		options: sorted,
	};
}

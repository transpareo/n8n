import type { INodeProperties } from 'n8n-workflow';
import { operationProperty, showFor } from '../shared/descriptions';

const resource = 'import';

const importId: INodeProperties = {
	displayName: 'Import ID',
	name: 'importId',
	type: 'string',
	required: true,
	default: '',
	placeholder: 'e.g. 7',
	displayOptions: showFor(resource, ['get', 'revert']),
	description: 'The ID that Run returned for the import',
};

export const importDescription: INodeProperties[] = [
	operationProperty(
		resource,
		[
			{
				name: 'Get',
				value: 'get',
				action: 'Get an import',
				description: 'Read the status, the counts and the row errors of an import',
				routing: {
					request: { method: 'GET', url: '=/imports/{{encodeURIComponent($parameter.importId)}}' },
				},
			},
			{
				name: 'Revert',
				value: 'revert',
				action: 'Revert an import',
				description:
					'Restore the backup an import took and remove the records it created. A passport import cannot be reverted.',
				routing: {
					request: {
						method: 'POST',
						url: '=/imports/{{encodeURIComponent($parameter.importId)}}/revert',
					},
				},
			},
			{
				name: 'Run',
				value: 'run',
				action: 'Import a spreadsheet',
				description:
					'Upload a spreadsheet or the input items, map the columns, validate and import the rows in the background',
			},
		],
		'run',
	),
	importId,
	{
		displayName: 'Force',
		name: 'force',
		type: 'boolean',
		default: false,
		displayOptions: showFor(resource, ['revert']),
		description:
			'Whether to revert although records changed since the import, which overwrites those changes',
		routing: { send: { type: 'body', property: 'options.force' } },
	},
	{
		displayName: 'Data Type',
		name: 'dataType',
		type: 'options',
		options: [
			{ name: 'Components', value: 'components' },
			{
				name: 'Passports',
				value: 'dpps',
				description:
					'One passport a row, published as it is written. A row names its product by GTIN, or by product name for a product without one.',
			},
			{ name: 'Products', value: 'products' },
		],
		default: 'products',
		displayOptions: showFor(resource, ['run']),
		description: 'What each row of the file is',
	},
	{
		displayName: 'Source',
		name: 'source',
		type: 'options',
		options: [
			{
				name: 'Binary File',
				value: 'binary',
				description:
					'A CSV, XLSX, ODS or JSON file each input item carries, such as from Read Files or HTTP Request. One import per item.',
			},
			{
				name: 'Input Items',
				value: 'items',
				description: 'The input items themselves, one row each, sent as one JSON file',
			},
		],
		default: 'binary',
		displayOptions: showFor(resource, ['run']),
		description:
			'Where the rows come from. A file holds at most 50 MB, 100,000 rows and 2,000,000 cells.',
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: { show: { resource: [resource], operation: ['run'], source: ['binary'] } },
		description:
			'The binary field of the input item that holds the file, at most 50 MB, 100,000 rows and 2,000,000 cells',
	},
	{
		displayName: 'Wait for Completion',
		name: 'waitForCompletion',
		type: 'boolean',
		default: true,
		displayOptions: showFor(resource, ['run']),
		description:
			'Whether to wait until every row is written and return the counts (created, updated, unchanged, failed), the row errors and the import ID a revert takes. Off, the node returns the import as it starts. The validation is always waited for.',
	},
	{
		displayName: 'Column Mappings',
		name: 'columnMappings',
		type: 'fixedCollection',
		placeholder: 'Add Mapping',
		typeOptions: { multipleValues: true },
		displayOptions: showFor(resource, ['run']),
		default: {},
		description:
			'Where a column goes when the mapping the workspace suggests does not fit. Every other column takes the suggestion.',
		options: [
			{
				displayName: 'Mapping',
				name: 'mapping',
				values: [
					{
						displayName: 'Column',
						name: 'column',
						type: 'string',
						default: '',
						description: 'The heading of the column in the file',
					},
					{
						displayName: 'Map To',
						name: 'mapTo',
						type: 'options',
						options: [
							{
								name: 'Attribute',
								value: 'attribute',
								description: 'A field of the record, such as name or gtin',
							},
							{
								name: 'New Property Type',
								value: 'newPropertyType',
								description: 'A property type the import adds to the workspace for good',
							},
							{ name: 'Property Type', value: 'propertyType' },
							{ name: 'Skip', value: 'skip', description: 'Leave the column out' },
						],
						default: 'attribute',
					},
					{
						displayName: 'Target',
						name: 'target',
						type: 'string',
						default: '',
						displayOptions: { hide: { mapTo: ['skip'] } },
						description:
							'The attribute, the name or ID of the property type, or the name of the new one',
					},
				],
			},
		],
	},
	{
		displayName: 'Unmatched Columns',
		name: 'unmatchedColumns',
		type: 'options',
		options: [
			{
				name: 'Create Property Types',
				value: 'create',
				description: 'Add a property type under the heading of each, to the workspace for good',
			},
			{ name: 'Skip', value: 'skip', description: 'Leave them out' },
			{
				name: 'Stop',
				value: 'stop',
				description: 'Stop before writing anything and name them with what the workspace suggests',
			},
		],
		default: 'stop',
		displayOptions: showFor(resource, ['run']),
		description: 'What happens to a column the workspace matches to no attribute or property type',
	},
	{
		displayName: 'Import Options',
		name: 'importOptions',
		type: 'collection',
		placeholder: 'Add Option',
		displayOptions: showFor(resource, ['run']),
		default: {},
		options: [
			{
				displayName: 'Backup',
				name: 'backup',
				type: 'boolean',
				default: true,
				description:
					'Whether to back up the records the import changes, which a revert restores. On unless switched off.',
			},
			{
				displayName: 'Publish',
				name: 'published',
				type: 'boolean',
				default: true,
				description: 'Whether to publish the records the import writes',
			},
			{
				displayName: 'Value Separator',
				name: 'valueSeparator',
				type: 'string',
				default: '',
				placeholder: 'e.g. ;',
				description: 'What separates several values in one cell',
			},
		],
	},
];

import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import { dynamicDataBody, eventBody, fieldsBody, passportBody, publishBody } from '../shared/body';
import { locator, operationProperty, showFor } from '../shared/descriptions';
import {
	filtersProperty,
	listOperation,
	listProperties,
	termFilter,
	timeFilters,
} from '../shared/listing';
import { passportPath } from '../shared/passport';

const resource = 'passport';

export const PASSPORT_STATUSES: INodePropertyOptions[] = [
	{ name: 'Collected', value: 'collected' },
	{ name: 'Draft', value: 'draft' },
	{ name: 'End of Life', value: 'end_of_life' },
	{ name: 'In Use', value: 'in_use' },
	{ name: 'Manufactured', value: 'manufactured' },
	{ name: 'Placed on Market', value: 'placed_on_market' },
	{ name: 'Recycled', value: 'recycled' },
	{ name: 'Refurbished', value: 'refurbished' },
	{ name: 'Repair', value: 'repair' },
	{ name: 'Suspended (Recall or Hold)', value: 'suspended' },
];

const writeOperations = ['create', 'validate'];

const operations: INodePropertyOptions[] = [
	{
		name: 'Append Event',
		value: 'appendEvent',
		action: 'Append an event to a passport',
		description:
			"Record an inspection, an incident or a status change, such as a recall, on the passport's log",
		routing: {
			request: { method: 'POST', url: '/dpps' },
			send: { preSend: [passportPath('id', '/events'), eventBody] },
			output: { postReceive: [{ type: 'rootProperty', properties: { property: 'event' } }] },
		},
	},
	{
		name: 'Correct',
		value: 'correct',
		action: 'Correct a passport from its product',
		description:
			'Carry a correction made to the product onto a published passport as a new signed version',
		routing: {
			request: { method: 'POST', url: '/dpps' },
			send: { preSend: [passportPath('id', '/correct'), fieldsBody('noteFields')] },
		},
	},
	{
		name: 'Create',
		value: 'create',
		action: 'Create a passport',
		description: 'Create a draft passport of a product, with the report a publish would produce',
		routing: {
			request: { method: 'POST', url: '/dpps' },
			send: { preSend: [passportBody] },
		},
	},
	{
		name: 'Get',
		value: 'get',
		action: 'Get a passport',
		description: 'Retrieve a passport',
		routing: {
			request: { method: 'GET', url: '/dpps' },
			send: { preSend: [passportPath('id')] },
		},
	},
	{
		name: 'Get Events',
		value: 'getEvents',
		action: 'Get the events of a passport',
		description: "List the events on the passport's log in the order they happened",
		routing: {
			request: { method: 'GET', url: '/dpps' },
			send: { preSend: [passportPath('id', '/events')] },
			output: { postReceive: [{ type: 'rootProperty', properties: { property: 'events' } }] },
		},
	},
	listOperation('/dpps', 'dpps', 'passports'),
	{
		name: 'Get Requirements',
		value: 'getRequirements',
		action: 'Get what a passport of a product needs',
		description:
			'Read which identifiers a passport of the product needs at the granularity the workspace issues, what the product still lacks and where each answer goes, and whether it is ready',
		routing: {
			request: {
				method: 'GET',
				url: '/dpps/requirements',
				qs: {
					productId: '={{$parameter.product}}',
				},
			},
		},
	},
	{
		name: 'Get Versions',
		value: 'getVersions',
		action: 'Get the versions of a passport',
		description: 'List the signed versions of the passport, newest first',
		routing: {
			request: { method: 'GET', url: '/dpps' },
			send: { preSend: [passportPath('id', '/versions')] },
			output: { postReceive: [{ type: 'rootProperty', properties: { property: 'versions' } }] },
		},
	},
	{
		name: 'Publish',
		value: 'publish',
		action: 'Publish a passport',
		description:
			'Sign the passport and register it as its next version. Publishing cannot be undone.',
		routing: {
			request: { method: 'POST', url: '/dpps' },
			send: { preSend: [passportPath('code', '/publish'), publishBody] },
		},
	},
	{
		name: 'Reissue',
		value: 'reissue',
		action: 'Reissue a passport',
		description:
			'Record that the passport was reissued for the same unit, such as a reprinted label',
		routing: {
			request: { method: 'POST', url: '/dpps' },
			send: { preSend: [passportPath('id', '/reissue'), fieldsBody('reissueFields')] },
		},
	},
	{
		name: 'Update',
		value: 'update',
		action: 'Update a passport',
		description: 'Update the fields of a passport',
		routing: {
			request: { method: 'PUT', url: '/dpps' },
			send: { preSend: [passportPath('id'), passportBody] },
		},
	},
	{
		name: 'Update Dynamic Data',
		value: 'updateDynamicData',
		action: 'Update the dynamic data of a passport',
		description:
			"Merge readings that change over the unit's life, such as its state of health, into the passport",
		routing: {
			request: { method: 'PATCH', url: '/dpps' },
			send: { preSend: [passportPath('id', '/dynamic_data'), dynamicDataBody] },
		},
	},
	{
		name: 'Validate',
		value: 'validate',
		action: 'Validate a passport',
		description: 'Check a passport as a publish would, without writing anything',
		routing: {
			request: { method: 'POST', url: '/dpps/validate' },
			send: { preSend: [passportBody] },
		},
	},
];

const passportOperations = operations
	.map((operation) => String(operation.value))
	.filter((value) => !['create', 'validate', 'getRequirements', 'getAll'].includes(value));

const granularity: INodeProperties = {
	displayName: 'Granularity',
	name: 'granularity',
	type: 'options',
	options: [
		{
			name: 'Batch',
			value: 'batch',
			description: 'One passport for a lot, which needs a lot identifier',
		},
		{
			name: 'Item',
			value: 'item',
			description:
				'One passport for a single unit, which needs a lot identifier and a serial number',
		},
		{
			name: 'Model',
			value: 'model',
			description: 'One passport for the product model',
		},
		{
			name: 'Workspace Default',
			value: '',
			description: 'The granularity the workspace is set to',
		},
	],
	default: '',
	displayOptions: showFor(resource, writeOperations),
	description:
		'Which unit the passport stands for. A workspace issues its passports at one granularity and refuses any other, so pick that one or leave Workspace Default.',
};

const dynamicDataJson: INodeProperties = {
	displayName: 'Dynamic Data (JSON)',
	name: 'dynamicData',
	type: 'json',
	default: '{}',
	description:
		"Values that change over the unit's life, keyed by the vocabulary term of their property type",
};

const description: INodeProperties = {
	displayName: 'Description',
	name: 'description',
	type: 'string',
	default: '',
};

const identifierFields: INodeProperties[] = [
	{
		displayName: 'Lot Identifier',
		name: 'batchIdentifier',
		type: 'string',
		default: '',
		description: 'The lot number. A lot is created with the first passport that names it.',
	},
	{
		displayName: 'Model Identifier',
		name: 'modelIdentifier',
		type: 'string',
		default: '',
		description: "Without one, the passport takes the product's GTIN or article number",
	},
	{
		displayName: 'Serial Number',
		name: 'serialIdentifier',
		type: 'string',
		default: '',
	},
];

export const passportDescription: INodeProperties[] = [
	operationProperty(resource, operations, 'get'),
	locator({
		name: 'product',
		displayName: 'Product',
		resource,
		operations: ['create', 'validate', 'getRequirements'],
		searchListMethod: 'searchProducts',
		description: 'The product the passport describes',
	}),
	locator({
		name: 'passport',
		displayName: 'Passport',
		resource,
		operations: passportOperations,
		searchListMethod: 'searchPassports',
		byCode: true,
		description: 'The list and By Code name a passport by the code printed on its label',
	}),
	granularity,
	{
		...identifierFields[0],
		required: true,
		displayOptions: {
			show: { resource: [resource], operation: writeOperations, granularity: ['batch', 'item'] },
		},
	},
	{
		...identifierFields[2],
		required: true,
		displayOptions: {
			show: { resource: [resource], operation: writeOperations, granularity: ['item'] },
		},
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: showFor(resource, writeOperations),
		default: {},
		options: [
			description,
			dynamicDataJson,
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'Sent again with the same key and body within a day, the create answers the passport it wrote instead of writing a second one',
				displayOptions: { show: { '/operation': ['create'] } },
			},
			{
				displayName: 'Locale',
				name: 'locale',
				type: 'string',
				default: '',
				placeholder: 'e.g. de',
			},
			identifierFields[1],
		],
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: showFor(resource, ['update']),
		default: {},
		options: [
			description,
			dynamicDataJson,
			...identifierFields,
			{
				displayName: 'Locale',
				name: 'locale',
				type: 'string',
				default: '',
				placeholder: 'e.g. de',
			},
		],
	},
	{
		displayName: 'Publish Fields',
		name: 'publishFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: showFor(resource, ['publish']),
		default: {},
		options: [
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'Sent again with the same key within a day, the publish answers the version it registered instead of minting another',
			},
			{
				displayName: 'Reason',
				name: 'reason',
				type: 'string',
				default: '',
				placeholder: 'e.g. edit',
				description: 'Recorded on the version as why it was minted',
			},
		],
	},
	{
		displayName: 'Event Type',
		name: 'eventType',
		type: 'options',
		required: true,
		options: [
			{ name: 'Incident', value: 'incident' },
			{ name: 'Inspection', value: 'inspection' },
			{ name: 'Ownership Transfer', value: 'ownership_transfer' },
			{
				name: 'Recall Note',
				value: 'recall',
				description:
					'An authority note that moves the passport nowhere. To recall a unit, use a status change to suspended.',
			},
			{ name: 'Registered With EU', value: 'registered_with_eu' },
			{
				name: 'Status Change',
				value: 'status_change',
				description: 'Moves the passport to another status, such as suspended for a recall',
			},
			{ name: 'Validation Warning', value: 'validation_warning' },
		],
		default: 'inspection',
		displayOptions: showFor(resource, ['appendEvent']),
	},
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		required: true,
		options: PASSPORT_STATUSES,
		default: 'in_use',
		displayOptions: {
			show: { resource: [resource], operation: ['appendEvent'], eventType: ['status_change'] },
		},
		description:
			'The status to move the passport to. A unit that must stop being used is moved to suspended, and its passport keeps answering a scan with the recall.',
	},
	{
		displayName: 'Event Fields',
		name: 'eventFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: showFor(resource, ['appendEvent']),
		default: {},
		options: [
			{
				displayName: 'Data (JSON)',
				name: 'data',
				type: 'json',
				default: '{}',
				description: 'Free-form metadata carried onto the event',
			},
			description,
			{
				displayName: 'GLN',
				name: 'gln',
				type: 'string',
				default: '',
				description: 'The GS1 Global Location Number of the place the event happened',
			},
			{
				displayName: 'Seal Now',
				name: 'publish',
				type: 'boolean',
				default: false,
				description:
					'Whether to seal the event at once instead of leaving it as a draft. A sealed status change registers a new version.',
			},
		],
	},
	{
		...dynamicDataJson,
		required: true,
		displayOptions: showFor(resource, ['updateDynamicData']),
		description: 'Keys to merge into the stored readings. A key sent as null is removed.',
	},
	{
		displayName: 'Fields',
		name: 'noteFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: showFor(resource, ['correct']),
		default: {},
		options: [{ ...description, description: 'A note carried onto the correction event' }],
	},
	{
		displayName: 'Fields',
		name: 'reissueFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: showFor(resource, ['reissue']),
		default: {},
		options: [
			{ ...description, description: 'A note carried onto the reissue event' },
			{
				displayName: 'Successor Code',
				name: 'successorCode',
				type: 'string',
				default: '',
				description: 'The code of a freshly issued passport readers are pointed to',
			},
		],
	},
	...listProperties(resource),
	filtersProperty(resource, [
		{
			displayName: 'Product ID',
			name: 'productId',
			type: 'number',
			default: 0,
			description: 'Keep only the passports of this product',
			routing: { send: { type: 'query', property: 'product_id' } },
		},
		{
			displayName: 'Status',
			name: 'status',
			type: 'multiOptions',
			options: PASSPORT_STATUSES,
			default: [],
			description: 'Keep only the passports in these statuses',
			routing: { send: { type: 'query', property: 'status', value: '={{$value.join(",")}}' } },
		},
		termFilter('passports'),
		...timeFilters,
	]),
];

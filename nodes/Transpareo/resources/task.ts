import type { INodeProperties } from 'n8n-workflow';
import { taskBody } from '../shared/body';
import { locator, operationProperty, showFor } from '../shared/descriptions';
import {
	filtersProperty,
	listOperation,
	listProperties,
	termFilter,
	timeFilters,
} from '../shared/listing';

const resource = 'task';

export const taskDescription: INodeProperties[] = [
	operationProperty(
		resource,
		[
			{
				name: 'Create',
				value: 'create',
				action: 'Create a task',
				description: 'Ask a person or an access group for something, optionally about one record',
				routing: {
					request: { method: 'POST', url: '/tasks' },
					send: { preSend: [taskBody] },
				},
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a task',
				description: 'Retrieve a task with the moves the credential may make on it',
				routing: {
					request: { method: 'GET', url: '=/tasks/{{$parameter.task}}' },
				},
			},
			{
				name: 'Get Assignees',
				value: 'getAssignees',
				action: 'Get task assignees',
				description:
					'Find the people and access groups a task may go to, with the key a task takes',
				routing: {
					request: {
						method: 'GET',
						url: '/tasks/assignees',
						qs: { term: '={{$parameter.term || undefined}}' },
					},
					output: {
						postReceive: [{ type: 'rootProperty', properties: { property: 'assignees' } }],
					},
				},
			},
			listOperation('/tasks', 'tasks', 'tasks'),
		],
		'get',
	),
	locator({
		name: 'task',
		displayName: 'Task',
		resource,
		operations: ['get'],
		searchListMethod: 'searchTasks',
	}),
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor(resource, ['create']),
		description: 'What needs doing, in one line',
	},
	{
		displayName: 'Assignee',
		name: 'assignee',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		displayOptions: showFor(resource, ['create']),
		description: 'The person or the access group the task goes to',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a person or a group...',
				typeOptions: { searchListMethod: 'searchAssignees', searchable: true },
			},
			{
				displayName: 'By Key',
				name: 'key',
				type: 'string',
				placeholder: 'e.g. AccessGroup:3',
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '^(User|AccessGroup):[0-9]+$',
							errorMessage: 'A key reads User:<id> or AccessGroup:<id>',
						},
					},
				],
			},
		],
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		displayOptions: showFor(resource, ['create']),
		default: {},
		options: [
			{
				displayName: 'Due On',
				name: 'dueOn',
				type: 'dateTime',
				default: '',
				description: 'The day the task is due; from the day after, it counts as overdue',
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'Sent again with the same key and body within a day, the create answers the task it wrote instead of asking twice',
			},
			{
				displayName: 'Note',
				name: 'note',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'Anything the person needs to get it done',
			},
			{
				displayName: 'Priority',
				name: 'priority',
				type: 'options',
				options: [
					{ name: 'High', value: 'high' },
					{ name: 'Low', value: 'low' },
					{ name: 'Normal', value: 'normal' },
					{ name: 'Urgent', value: 'urgent' },
				],
				default: 'normal',
			},
			{
				displayName: 'Subject ID',
				name: 'subjectId',
				type: 'number',
				default: 0,
				description: 'The ID of the record the task is about, of the subject type',
			},
			{
				displayName: 'Subject Type',
				name: 'subjectType',
				type: 'options',
				options: [
					{ name: 'Component', value: 'Component' },
					{ name: 'Lot', value: 'Batch' },
					{ name: 'Passport', value: 'Dpp' },
					{ name: 'Product', value: 'Product' },
				],
				default: 'Product',
				description: 'The kind of record the task is about. It needs a subject ID too.',
			},
		],
	},
	{
		displayName: 'Search Term',
		name: 'term',
		type: 'string',
		default: '',
		displayOptions: showFor(resource, ['getAssignees']),
		description: 'Words in the name of the person or the group',
	},
	{
		displayName: 'List',
		name: 'list',
		type: 'options',
		options: [
			{
				name: 'All',
				value: 'all',
				description: 'Every task the credential takes part in',
			},
			{
				name: 'Done',
				value: 'done',
				description: 'The finished and cancelled tasks the credential took part in',
			},
			{
				name: 'Mine',
				value: 'mine',
				description: 'What waits on the person the credential acts for',
			},
			{
				name: 'Requested',
				value: 'requested',
				description: 'The open tasks the credential asked of others',
			},
			{
				name: 'Waiting',
				value: 'waiting',
				description: 'Requests waiting for a supplier, and tasks someone else has claimed',
			},
		],
		default: 'requested',
		displayOptions: showFor(resource, ['getAll']),
		description:
			'Which list to read. A credential acting as itself finds what it asked for under Requested and Done.',
		routing: { send: { type: 'query', property: 'list' } },
	},
	...listProperties(resource),
	filtersProperty(resource, [termFilter('tasks'), ...timeFilters]),
];

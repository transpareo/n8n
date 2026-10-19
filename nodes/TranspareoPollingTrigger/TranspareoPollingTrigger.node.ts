import {
	NodeConnectionTypes,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IPollFunctions,
} from 'n8n-workflow';
import { credentialTest } from '../shared/connection';
import { ALL_EVENTS } from '../shared/events';
import { pollFeed, pollRecords, type RecordWatch } from './watch';

const WATCHES: Record<string, RecordWatch> = {
	componentCreated: { path: '/components', rootProperty: 'components', stamp: 'createdAt' },
	componentUpdated: { path: '/components', rootProperty: 'components', stamp: 'updatedAt' },
	passportCreated: { path: '/dpps', rootProperty: 'dpps', stamp: 'createdAt' },
	passportUpdated: { path: '/dpps', rootProperty: 'dpps', stamp: 'updatedAt' },
	productCreated: { path: '/products', rootProperty: 'products', stamp: 'createdAt' },
	productUpdated: { path: '/products', rootProperty: 'products', stamp: 'updatedAt' },
};

export class TranspareoPollingTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Transpareo Polling Trigger',
		name: 'transpareoPollingTrigger',
		icon: {
			light: 'file:../../icons/transpareo.svg',
			dark: 'file:../../icons/transpareo.dark.svg',
		},
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description:
			'Starts the workflow when products, components or Digital Product Passports of a Transpareo workspace are created or updated, or when a passport records an event',
		defaults: {
			name: 'Transpareo Polling Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'transpareoApi',
				required: true,
				testedBy: 'transpareoApiTest',
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				options: [
					{
						name: 'Component Created',
						value: 'componentCreated',
						description: 'A component was added to the workspace',
					},
					{
						name: 'Component Updated',
						value: 'componentUpdated',
						description: 'A component was created or changed',
					},
					{
						name: 'Passport Created',
						value: 'passportCreated',
						description: 'A Digital Product Passport was created',
					},
					{
						name: 'Passport Event',
						value: 'passportEvent',
						description:
							'A passport recorded an event, such as a publish, an inspection or a status change',
					},
					{
						name: 'Passport Updated',
						value: 'passportUpdated',
						description: 'A passport was created or changed',
					},
					{
						name: 'Product Created',
						value: 'productCreated',
						description: 'A product was added to the workspace',
					},
					{
						name: 'Product Updated',
						value: 'productUpdated',
						description: 'A product was created or changed',
					},
				],
				default: 'productUpdated',
				required: true,
			},
			{
				displayName: 'Event Types',
				name: 'eventTypes',
				type: 'multiOptions',
				options: ALL_EVENTS,
				default: [],
				displayOptions: { show: { event: ['passportEvent'] } },
				description: 'The passport events that start the workflow. None picked means all of them.',
			},
			{
				displayName: 'Passport Code',
				name: 'passportCode',
				type: 'string',
				default: '',
				displayOptions: { show: { event: ['passportEvent'] } },
				description:
					'Confine the trigger to the passport with this code. Empty means every passport.',
			},
		],
	};

	methods = { credentialTest };

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const event = this.getNodeParameter('event') as string;
		if (event !== 'passportEvent') return await pollRecords(this, WATCHES[event]);

		const watch = {
			types: this.getNodeParameter('eventTypes', []) as string[],
			passportCode: String(this.getNodeParameter('passportCode', '')).trim(),
		};
		return await pollFeed(this, watch);
	}
}

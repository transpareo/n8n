import {
	NodeApiError,
	NodeConnectionTypes,
	type IDataObject,
	type IHookFunctions,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
	type JsonObject,
} from 'n8n-workflow';
import { credentialTest } from '../shared/connection';
import { VERSIONED_EVENTS } from '../shared/events';
import { apiRequest, refusalOf, statusOf } from '../shared/transport';
import { verifySignature } from './signature';

const PUBLIC_ADDRESSES_ONLY =
	'Transpareo delivers to public https addresses only, at most ten per credential. Where n8n runs on a private address, use the Transpareo Polling Trigger.';

type Subscription = {
	id: number;
	url: string;
	active: boolean;
	secret?: string;
};

type WebhookRequest = {
	rawBody?: Buffer;
};

function forget(staticData: IDataObject) {
	delete staticData.webhookId;
	delete staticData.secret;
}

export class TranspareoTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Transpareo Trigger',
		name: 'transpareoTrigger',
		icon: {
			light: 'file:../../icons/transpareo.svg',
			dark: 'file:../../icons/transpareo.dark.svg',
		},
		group: ['trigger'],
		version: 1,
		subtitle: '={{($parameter["events"] || []).join(", ") || "All passport events"}}',
		description:
			'Starts the workflow when a Digital Product Passport of a Transpareo workspace registers a version',
		defaults: {
			name: 'Transpareo Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'transpareoApi',
				required: true,
				testedBy: 'transpareoApiTest',
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'Transpareo delivers to public https addresses only. Where n8n runs on a private address, use the Transpareo Polling Trigger instead.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: VERSIONED_EVENTS,
				default: [],
				description: 'The passport events that start the workflow. None picked means all of them.',
			},
			{
				displayName: 'Passport Codes',
				name: 'passportCodes',
				type: 'string',
				typeOptions: { multipleValues: true, multipleValueButtonText: 'Add Passport Code' },
				default: [],
				description:
					'Confine the trigger to these passports by the code on their label. None means every passport.',
			},
		],
	};

	methods = { credentialTest };

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				if (staticData.webhookId === undefined) return false;

				let subscription: Subscription;
				try {
					subscription = (await apiRequest.call(
						this,
						'GET',
						`/webhooks/${staticData.webhookId}`,
					)) as Subscription;
				} catch (error) {
					if (statusOf(error) !== 404) throw new NodeApiError(this.getNode(), error as JsonObject);
					this.logger.info('Transpareo webhook subscription no longer exists', {
						id: staticData.webhookId,
					});
					forget(staticData);
					return false;
				}

				const current =
					subscription.active && subscription.url === this.getNodeWebhookUrl('default');
				if (current) return true;

				// A subscription the failures switched off, or one for another
				// address, makes way for a new one.
				await apiRequest.call(this, 'DELETE', `/webhooks/${subscription.id}`);
				forget(staticData);
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhook = {
					name: `n8n: ${this.getWorkflow().name ?? this.getWorkflow().id}`,
					url: this.getNodeWebhookUrl('default'),
					eventTypes: this.getNodeParameter('events', []) as string[],
					resourceScopeDppCodes: this.getNodeParameter('passportCodes', []) as string[],
				};

				let subscription: Subscription;
				try {
					subscription = (await apiRequest.call(this, 'POST', '/webhooks', {
						body: { webhook },
					})) as Subscription;
				} catch (error) {
					if (statusOf(error) !== 422) throw new NodeApiError(this.getNode(), error as JsonObject);
					throw refusalOf(this.getNode(), error, PUBLIC_ADDRESSES_ONLY);
				}

				const staticData = this.getWorkflowStaticData('node');
				staticData.webhookId = subscription.id;
				staticData.secret = subscription.secret;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				if (staticData.webhookId === undefined) return true;

				try {
					await apiRequest.call(this, 'DELETE', `/webhooks/${staticData.webhookId}`);
				} catch (error) {
					if (statusOf(error) !== 404) throw new NodeApiError(this.getNode(), error as JsonObject);
					this.logger.info('Transpareo webhook subscription was already gone', {
						id: staticData.webhookId,
					});
				}
				forget(staticData);
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const staticData = this.getWorkflowStaticData('node');
		const request = this.getRequestObject() as unknown as WebhookRequest;
		const header = this.getHeaderData()['x-transpareo-signature'] as string | undefined;
		const now = Math.floor(Date.now() / 1000);
		const rawBody = request.rawBody;

		const genuine =
			!!rawBody && verifySignature(String(staticData.secret ?? ''), header, rawBody, now);
		if (!genuine) {
			this.getResponseObject().status(401).send('Signature does not match');
			return { noWebhookResponse: true };
		}

		const delivery = this.getBodyData();
		if (delivery.type === 'ping') return { webhookResponse: { received: true } };

		return { workflowData: [[{ json: delivery }]] };
	}
}

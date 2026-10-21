import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
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

import { mailflossApiRequest } from '../Mailfloss/GenericFunctions';

// Labels follow the mailfloss dashboard's webhook page.
const EVENTS: Array<[value: string, name: string]> = [
	['job-finished', 'Flossing Completed'],
	['contact-deleted', 'Contact Deleted'],
	['contact-fixed', 'Contact Fixed'],
	['contact-tagged', 'Contact Tagged'],
	['contact-unsubscribed', 'Contact Unsubscribed'],
	['contact-updated', 'Contact Updated'],
	['status-risky', 'Result: Risky'],
	['status-undeliverable', 'Result: Undeliverable'],
	['status-unknown', 'Result: Unknown'],
	['reason-accept_all', 'Reason: Accept All'],
	['reason-available', 'Reason: Available'],
	['reason-banned', 'Reason: Banned'],
	['reason-blacklisted', 'Reason: Blacklisted'],
	['reason-bounced', 'Reason: Bounced'],
	['reason-complainer', 'Reason: Complainer'],
	['reason-deactivated', 'Reason: Deactivated'],
	['reason-disposable', 'Reason: Disposable'],
	['reason-illegitimate', 'Reason: Illegitimate'],
	['reason-inbox_full', 'Reason: Inbox Full'],
	['reason-invalid', 'Reason: Invalid'],
	['reason-nonexistent', 'Reason: Nonexistent'],
	['reason-role', 'Reason: Role'],
	['reason-spam', 'Reason: Spam'],
	['reason-unverified', 'Reason: Unverified'],
];

// Matches the HTTP status, or mailfloss's own error code if the status wasn't kept.
function isNotFound(error: unknown): boolean {
	if (!(error instanceof NodeApiError)) return false;
	const data = error.context.data as { error?: { code?: string } } | undefined;
	return error.httpCode === '404' || data?.error?.code === 'not_found';
}

function hasSecret(secret: unknown): secret is string {
	return typeof secret === 'string' && secret !== '';
}

function sameEvents(a: unknown, b: string[]): boolean {
	return Array.isArray(a) && [...a].sort().join() === [...b].sort().join();
}

export class MailflossTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'mailfloss Trigger',
		name: 'mailflossTrigger',
		icon: {
			light: 'file:../Mailfloss/mailfloss.svg',
			dark: 'file:../Mailfloss/mailfloss.dark.svg',
		},
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when mailfloss sends a webhook event',
		defaults: {
			name: 'mailfloss Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'mailflossApi', required: true }],
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
					'Webhooks need a mailfloss plan that includes them, and an n8n URL that mailfloss can reach over the internet',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: [],
				options: EVENTS.map(([value, name]) => ({ name, value })),
				description: 'The mailfloss events that start the workflow',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				if (typeof staticData.webhookId !== 'string') return false;
				const path = `/v1/webhooks/${encodeURIComponent(staticData.webhookId)}`;
				try {
					const subscription = await mailflossApiRequest.call(this, 'GET', path);
					if (
						hasSecret(staticData.secret) &&
						subscription.url === this.getNodeWebhookUrl('default') &&
						subscription.active !== false &&
						sameEvents(subscription.events, this.getNodeParameter('events') as string[])
					) {
						return true;
					}
					// Stale: wrong URL or events, a lost signing secret, or mailfloss deactivated it
					// after failed deliveries.
					await mailflossApiRequest.call(this, 'DELETE', path);
				} catch (error) {
					if (!isNotFound(error)) throw new NodeApiError(this.getNode(), error as JsonObject);
				}
				delete staticData.webhookId;
				delete staticData.secret;
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const workflow = this.getWorkflow();
				const secret = randomBytes(32).toString('hex');
				const subscription = await mailflossApiRequest.call(this, 'POST', '/v1/webhooks', {
					body: {
						name: `n8n: ${workflow.name ?? workflow.id ?? 'workflow'}`.slice(0, 200),
						url: this.getNodeWebhookUrl('default'),
						events: this.getNodeParameter('events') as string[],
						secret,
					},
				});
				staticData.webhookId = subscription.id;
				staticData.secret = secret;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				if (typeof staticData.webhookId === 'string') {
					try {
						await mailflossApiRequest.call(
							this,
							'DELETE',
							`/v1/webhooks/${encodeURIComponent(staticData.webhookId)}`,
						);
					} catch (error) {
						if (!isNotFound(error)) return false;
					}
				}
				delete staticData.webhookId;
				delete staticData.secret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const { secret } = this.getWorkflowStaticData('node');
		const body = this.getBodyData() as IDataObject;
		const payload = (body.data ?? {}) as IDataObject;

		// mailfloss signs each delivery: hex HMAC-SHA1 of JSON.stringify(data), keyed with
		// the secret this node set when it created the subscription. No secret, no delivery.
		const received = Buffer.from(String(this.getHeaderData()['x-request-signature'] ?? ''));
		const expected = hasSecret(secret)
			? Buffer.from(createHmac('sha1', secret).update(JSON.stringify(payload)).digest('hex'))
			: undefined;
		if (!expected || received.length !== expected.length || !timingSafeEqual(received, expected)) {
			this.getResponseObject().status(401).send('Signature mismatch');
			return { noWebhookResponse: true };
		}

		return { workflowData: [this.helpers.returnJsonArray(payload)] };
	}
}

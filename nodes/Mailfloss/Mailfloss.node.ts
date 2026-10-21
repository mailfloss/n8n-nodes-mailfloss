import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
} from 'n8n-workflow';

import { mailflossApiRequest } from './GenericFunctions';

// Fields kept when 'Simplify' is on; the full verdict has 12.
const SIMPLE_VERIFY_FIELDS = [
	'email',
	'status',
	'reason',
	'passed',
	'suggestion',
	'disposable',
	'role',
	'free',
];

// The API caps results pages at 1000.
const MAX_PAGE_SIZE = 1000;

function toEmailList(value: unknown): string[] {
	const parts = Array.isArray(value) ? value : String(value ?? '').split(/[\n,;]/);
	return parts.map((part) => String(part).trim()).filter((part) => part !== '');
}

export class Mailfloss implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'mailfloss',
		name: 'mailfloss',
		icon: { light: 'file:mailfloss.svg', dark: 'file:mailfloss.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Verify email addresses with mailfloss',
		defaults: {
			name: 'mailfloss',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'mailflossApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Batch', value: 'batch' },
					{ name: 'Email', value: 'email' },
				],
				default: 'email',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['email'] } },
				options: [
					{
						name: 'Verify',
						value: 'verify',
						action: 'Verify email',
						description: 'Verify an email address in real time',
					},
				],
				default: 'verify',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['batch'] } },
				options: [
					{
						name: 'Get Results',
						value: 'getResults',
						action: 'Get batch results',
						description: 'Get the verification result for each email in a batch',
					},
					{
						name: 'Get Status',
						value: 'getStatus',
						action: 'Get batch status',
						description: 'Get the progress and verdict counts of a batch',
					},
					{
						name: 'Start',
						value: 'start',
						action: 'Start batch',
						description: 'Start one batch verification job for the emails from all input items',
					},
				],
				default: 'start',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'e.g. name@example.com',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['email'], operation: ['verify'] } },
				description: 'The email address to verify',
			},
			{
				displayName: 'Simplify',
				name: 'simplify',
				type: 'boolean',
				default: true,
				displayOptions: { show: { resource: ['email'], operation: ['verify'] } },
				description: 'Whether to return only the main verdict fields instead of the full response',
			},
			{
				displayName: 'Emails',
				name: 'emails',
				type: 'string',
				placeholder: 'e.g. {{ $json.email }}',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['batch'], operation: ['start'] } },
				description:
					'One email address, a comma- or newline-separated list, or an array. The node combines the emails from all input items into a single batch.',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['batch'], operation: ['start'] } },
				options: [
					{
						displayName: 'Webhook URL',
						name: 'webhookUrl',
						type: 'string',
						placeholder: 'e.g. https://example.com/webhook',
						default: '',
						description: 'URL that mailfloss sends a POST request to when the batch finishes',
					},
				],
			},
			{
				displayName: 'Batch ID',
				name: 'batchId',
				type: 'string',
				placeholder: 'e.g. job_a1b2c3d4e5f6g7h8',
				required: true,
				default: '',
				displayOptions: { show: { resource: ['batch'], operation: ['getStatus', 'getResults'] } },
				description: "The 'ID' returned by the Start operation",
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['batch'], operation: ['getResults'] } },
				description: 'Whether to return all results or only up to a given limit',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				displayOptions: {
					show: { resource: ['batch'], operation: ['getResults'], returnAll: [false] },
				},
				description: 'Max number of results to return',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		if (resource === 'batch' && operation === 'start') {
			return [await startBatch.call(this, items)];
		}

		const returnData: INodeExecutionData[] = [];
		for (let i = 0; i < items.length; i++) {
			try {
				if (resource === 'email' && operation === 'verify') {
					const email = this.getNodeParameter('email', i) as string;
					const verdict = await mailflossApiRequest.call(this, 'GET', '/v1/verify', {
						qs: { email },
						itemIndex: i,
					});
					const simplify = this.getNodeParameter('simplify', i) as boolean;
					const json = simplify
						? Object.fromEntries(
								SIMPLE_VERIFY_FIELDS.filter((key) => key in verdict).map((key) => [
									key,
									verdict[key],
								]),
							)
						: verdict;
					returnData.push({ json, pairedItem: { item: i } });
				} else if (resource === 'batch' && operation === 'getStatus') {
					const batchId = encodeURIComponent(this.getNodeParameter('batchId', i) as string);
					const status = await mailflossApiRequest.call(
						this,
						'GET',
						`/v1/batch-verify/${batchId}/status`,
						{ itemIndex: i },
					);
					returnData.push({ json: status, pairedItem: { item: i } });
				} else if (resource === 'batch' && operation === 'getResults') {
					const batchId = encodeURIComponent(this.getNodeParameter('batchId', i) as string);
					const returnAll = this.getNodeParameter('returnAll', i) as boolean;
					const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
					const results: IDataObject[] = [];
					let next: string | undefined;
					do {
						const page = await mailflossApiRequest.call(
							this,
							'GET',
							`/v1/batch-verify/${batchId}/results`,
							{
								qs: { per_page: Math.min(limit - results.length, MAX_PAGE_SIZE), next },
								itemIndex: i,
							},
						);
						results.push(...((page.data as IDataObject[] | undefined) ?? []));
						next = typeof page.next === 'string' && page.next !== '' ? page.next : undefined;
					} while (next !== undefined && results.length < limit);
					for (const result of results.slice(0, limit)) {
						returnData.push({ json: result, pairedItem: { item: i } });
					}
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				// Already a NodeApiError from mailflossApiRequest; the constructor returns it as is.
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}
		return [returnData];
	}
}

async function startBatch(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	const pairedItem = items.map((_, item) => ({ item }));
	const emails = items.flatMap((_, i) => toEmailList(this.getNodeParameter('emails', i)));
	if (emails.length === 0) {
		throw new NodeOperationError(this.getNode(), 'No email addresses to verify', {
			description:
				"Set 'Emails' to an address, a list of addresses, or an expression such as {{ $json.email }}",
		});
	}
	const { webhookUrl } = this.getNodeParameter('options', 0) as { webhookUrl?: string };
	const body: IDataObject = { emails };
	if (webhookUrl) body.webhook_url = webhookUrl;
	try {
		const job = await mailflossApiRequest.call(this, 'POST', '/v1/batch-verify', { body });
		return [{ json: job, pairedItem }];
	} catch (error) {
		if (this.continueOnFail()) {
			return [{ json: { error: (error as Error).message }, pairedItem }];
		}
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

// Unit tests against the compiled nodes in dist/ (run `npm test`, which builds first).
// The boundary is n8n's request helper: each test scripts the API responses and
// checks the requests the node sent and the items it returned. No network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');

const { Mailfloss } = require('../dist/nodes/Mailfloss/Mailfloss.node.js');
const { MailflossTrigger } = require('../dist/nodes/MailflossTrigger/MailflossTrigger.node.js');

function apiError(status, code) {
	const error = new Error(`Request failed with status code ${status}`);
	error.response = { status, data: { error: { code, message: code } } };
	return error;
}

function context({ params = {}, items = [{ json: {} }], responses = [], staticData = {}, headers = {}, body = {} }) {
	const ctx = {
		requests: [],
		staticData,
		response: {},
		getInputData: () => items,
		getNodeParameter: (name, i) => (typeof params[name] === 'function' ? params[name](i) : params[name]),
		getNode: () => ({ name: 'mailfloss', type: 'mailfloss', typeVersion: 1, parameters: {} }),
		continueOnFail: () => false,
		getWorkflowStaticData: () => staticData,
		getWorkflow: () => ({ id: 'wf1', name: 'Lead cleanup' }),
		getNodeWebhookUrl: () => 'https://n8n.example.com/webhook/abc',
		getHeaderData: () => headers,
		getBodyData: () => body,
		getResponseObject: () => ({
			status(code) {
				ctx.response.status = code;
				return this;
			},
			send(text) {
				ctx.response.body = text;
			},
		}),
		helpers: {
			async httpRequestWithAuthentication(credential, options) {
				assert.equal(credential, 'mailflossApi');
				ctx.requests.push(options);
				const next = responses.shift();
				if (next instanceof Error) throw next;
				return next;
			},
			returnJsonArray: (data) => (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
		},
	};
	return ctx;
}

test('Verify sends the email and simplifies the verdict', async () => {
	const ctx = context({
		params: { resource: 'email', operation: 'verify', email: 'jane@example.com', simplify: true },
		responses: [
			{ email: 'jane@example.com', status: 'passed', reason: 'valid', passed: true, meta: '', relay: false },
		],
	});
	const [out] = await new Mailfloss().execute.call(ctx);
	assert.equal(ctx.requests[0].url, 'https://api.mailfloss.com/v1/verify');
	assert.deepEqual(ctx.requests[0].qs, { email: 'jane@example.com' });
	assert.deepEqual(out, [
		{ json: { email: 'jane@example.com', status: 'passed', reason: 'valid', passed: true }, pairedItem: { item: 0 } },
	]);
});

test('Start batch combines the emails from every input item into one job', async () => {
	const emails = ['a@example.com', 'b@example.com, c@example.com', ['d@example.com', ' ']];
	const ctx = context({
		items: emails.map(() => ({ json: {} })),
		params: { resource: 'batch', operation: 'start', emails: (i) => emails[i], options: {} },
		responses: [{ id: 'job_1' }],
	});
	const [out] = await new Mailfloss().execute.call(ctx);
	assert.equal(ctx.requests.length, 1);
	assert.equal(ctx.requests[0].method, 'POST');
	assert.deepEqual(ctx.requests[0].body, {
		emails: ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'],
	});
	assert.deepEqual(out, [{ json: { id: 'job_1' }, pairedItem: [{ item: 0 }, { item: 1 }, { item: 2 }] }]);
});

test('Start batch refuses an empty email list before calling the API', async () => {
	const ctx = context({ params: { resource: 'batch', operation: 'start', emails: ' ', options: {} } });
	await assert.rejects(new Mailfloss().execute.call(ctx), /No email addresses to verify/);
	assert.equal(ctx.requests.length, 0);
});

test('Get results follows the cursor and stops at the limit', async () => {
	const row = (n) => ({ email: `${n}@example.com` });
	const ctx = context({
		params: { resource: 'batch', operation: 'getResults', batchId: 'job/1', returnAll: false, limit: 3 },
		responses: [
			{ data: [row(1), row(2)], next: 'c2' },
			{ data: [row(3), row(4)], next: 'c3' },
		],
	});
	const [out] = await new Mailfloss().execute.call(ctx);
	assert.equal(ctx.requests[0].url, 'https://api.mailfloss.com/v1/batch-verify/job%2F1/results');
	assert.deepEqual(ctx.requests.map((r) => r.qs), [
		{ per_page: 3, next: undefined },
		{ per_page: 1, next: 'c2' },
	]);
	assert.deepEqual(out.map((item) => item.json.email), ['1@example.com', '2@example.com', '3@example.com']);
});

test('API failures surface as NodeApiError with the item index', async () => {
	const ctx = context({
		params: { resource: 'batch', operation: 'getStatus', batchId: 'job_x' },
		responses: [apiError(404, 'not_found')],
	});
	await assert.rejects(new Mailfloss().execute.call(ctx), (error) => {
		assert.equal(error.constructor.name, 'NodeApiError');
		assert.equal(error.context.itemIndex, 0);
		return true;
	});
});

test('Trigger create subscribes with a signing secret and stores it', async () => {
	const ctx = context({ params: { events: ['job-finished'] }, responses: [{ id: 'wh_1' }] });
	assert.equal(await new MailflossTrigger().webhookMethods.default.create.call(ctx), true);
	const { body } = ctx.requests[0];
	assert.equal(ctx.requests[0].url, 'https://api.mailfloss.com/v1/webhooks');
	assert.deepEqual(
		{ name: body.name, url: body.url, events: body.events },
		{ name: 'n8n: Lead cleanup', url: 'https://n8n.example.com/webhook/abc', events: ['job-finished'] },
	);
	assert.match(body.secret, /^[0-9a-f]{64}$/);
	assert.deepEqual(ctx.staticData, { webhookId: 'wh_1', secret: body.secret });
});

test('Trigger checkExists replaces a subscription whose events changed', async () => {
	const ctx = context({
		params: { events: ['status-risky'] },
		staticData: { webhookId: 'wh_1', secret: 's' },
		responses: [{ id: 'wh_1', url: 'https://n8n.example.com/webhook/abc', events: ['job-finished'], active: true }, {}],
	});
	assert.equal(await new MailflossTrigger().webhookMethods.default.checkExists.call(ctx), false);
	assert.deepEqual(ctx.requests.map((r) => r.method), ['GET', 'DELETE']);
	assert.deepEqual(ctx.staticData, {});
});

test('Trigger checkExists keeps a matching subscription and treats 404 as gone', async () => {
	const trigger = new MailflossTrigger();
	const live = context({
		params: { events: ['status-risky', 'job-finished'] },
		staticData: { webhookId: 'wh_1', secret: 's' },
		responses: [{ url: 'https://n8n.example.com/webhook/abc', events: ['job-finished', 'status-risky'], active: true }],
	});
	assert.equal(await trigger.webhookMethods.default.checkExists.call(live), true);

	// Same subscription, but the signing secret is gone: replace it rather than accept unsigned deliveries.
	const noSecret = context({
		params: { events: ['job-finished'] },
		staticData: { webhookId: 'wh_1' },
		responses: [{ url: 'https://n8n.example.com/webhook/abc', events: ['job-finished'], active: true }, {}],
	});
	assert.equal(await trigger.webhookMethods.default.checkExists.call(noSecret), false);
	assert.deepEqual(noSecret.requests.map((r) => r.method), ['GET', 'DELETE']);

	const gone = context({ params: { events: ['job-finished'] }, staticData: { webhookId: 'wh_1' }, responses: [apiError(404, 'not_found')] });
	assert.equal(await trigger.webhookMethods.default.checkExists.call(gone), false);
});

test('Trigger webhook accepts a signed delivery and rejects forged, unsigned or secretless ones', async () => {
	const data = { event: 'job.finished', id: 'job_1', numPassed: 3 };
	const secret = 'a'.repeat(64);
	const signature = createHmac('sha1', secret).update(JSON.stringify(data)).digest('hex');
	const trigger = new MailflossTrigger();

	const signed = context({ staticData: { secret }, headers: { 'x-request-signature': signature }, body: { data } });
	assert.deepEqual(await trigger.webhook.call(signed), { workflowData: [[{ json: data }]] });

	const rejected = [
		context({ staticData: { secret }, headers: { 'x-request-signature': '0'.repeat(40) }, body: { data } }),
		context({ staticData: { secret }, body: { data } }),
		context({ staticData: {}, headers: { 'x-request-signature': signature }, body: { data } }),
		context({ staticData: { secret: '' }, headers: { 'x-request-signature': signature }, body: { data } }),
	];
	for (const ctx of rejected) {
		assert.deepEqual(await trigger.webhook.call(ctx), { noWebhookResponse: true });
		assert.equal(ctx.response.status, 401);
	}
});

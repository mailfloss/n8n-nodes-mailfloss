# @mailfloss/n8n-nodes-mailfloss

This is an n8n community node for [mailfloss](https://mailfloss.com) email verification. It
lets you verify email addresses in real time, run batch verification jobs, and start
workflows from mailfloss webhook events.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/)
workflow automation platform.

- [Installation](#installation)
- [Credentials](#credentials)
- [Operations](#operations)
- [Trigger](#trigger)
- [Example workflows](#example-workflows)
- [Compatibility](#compatibility)
- [Resources](#resources)
- [Development](#development)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)
in the n8n community nodes documentation, and install the package
`@mailfloss/n8n-nodes-mailfloss`.

## Credentials

The nodes authenticate with a mailfloss API key.

1. Sign in to [mailfloss](https://mailfloss.com) and open **Settings → API** in the dashboard.
2. Copy your API key.
3. In n8n, create a **mailfloss.com API** credential and paste the key into **API Key**.

n8n tests the key against `GET /v1/check-key` when you save the credential. The key is sent as
an `Authorization: Bearer` header on every request.

## Operations

The **mailfloss** node has two resources.

**Email**

- **Verify**: verifies one email address in real time and returns its verdict: `status`
  (`passed`, `undeliverable`, `risky` or `unknown`), `reason`, `passed`, and a `suggestion`
  when the address looks like a typo. Turn off **Simplify** to get every field the API returns.

**Batch**

- **Start**: starts one batch verification job. The node combines the emails from all input
  items into a single job, so map **Emails** to a field such as `{{ $json.email }}`. A field can
  also hold a comma- or newline-separated list, or an array. Optionally set a **Webhook URL**
  that mailfloss calls when the job finishes. Returns the job `id`.
- **Get Status**: returns the progress and verdict counts of a job.
- **Get Results**: returns one item per verified email. Use **Return All**, or **Limit** to
  cap the number of results.

The node can also be used as a tool by n8n AI agents.

## Trigger

The **mailfloss Trigger** node starts a workflow when mailfloss sends a webhook event. Pick one
or more events, for example **Flossing Completed** (a verification job finished),
**Result: Undeliverable**, **Result: Risky** or **Reason: Disposable**.

When you activate the workflow, the node creates a webhook subscription in your mailfloss
account with a random signing secret, and deletes the subscription when you deactivate it.
The node checks the `X-Request-Signature` header of each delivery and rejects deliveries
that aren't signed with that secret.

Requirements:

- Your mailfloss plan must include webhooks.
- mailfloss must be able to reach your n8n instance over the internet. mailfloss rejects
  webhook URLs on localhost and private networks, so set n8n's `WEBHOOK_URL` to a public URL.

## Example workflows

- **Verify sign-ups before they reach your CRM.** Form trigger → **mailfloss** (Email →
  Verify) → **If** `{{ $json.status }}` is `passed` → add the contact to your CRM. Send the
  other branch to a review list, and use `{{ $json.suggestion }}` to offer a corrected address.
- **Clean a list in one job.** Read rows from a spreadsheet → **mailfloss** (Batch → Start)
  with **Emails** set to `{{ $json.email }}` and **Webhook URL** pointing at a second workflow.
  In that workflow, use a **Webhook** node → **mailfloss** (Batch → Get Results, **Batch ID**
  `{{ $json.body.data.id }}`) → write each verdict back to the sheet.
- **React to risky addresses.** **mailfloss Trigger** with **Result: Risky** → post the
  address to a Slack channel.

## Compatibility

Built with `@n8n/node-cli` 0.53 against `n8n-workflow` 2.x (n8n nodes API version 1).
The package has no runtime dependencies.

## Resources

- [mailfloss API documentation](https://developers.mailfloss.com)
- [mailfloss OpenAPI spec](https://api.mailfloss.com/v1/openapi.json)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## Development

```bash
npm ci
npm run hooks   # once per clone: pre-commit runs lint, build, tests and a secret scan
npm run lint    # n8n's community-node lint rules (the same rules as n8n's scanner)
npm test        # builds, then runs the unit tests in test/
npm run dev     # starts a local n8n with the node loaded
```

Releases publish from GitHub Actions with npm provenance, as n8n requires for verified nodes:
push a version tag such as `0.1.1` and `.github/workflows/publish.yml` publishes it.

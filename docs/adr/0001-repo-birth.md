# ADR 0001: Repo birth decisions

Status: accepted, 2026-10-21 (MAI-2927)

## 1. Feedback loops

- `npm run lint` runs `n8n-node lint`: n8n's community-node rules, the same rule sets
  `@n8n/scan-community-package` applies before verification. The scanner ignores inline
  `eslint-disable` comments, so neither do we.
- `npm test` builds with `tsc` (via `n8n-node build`, which is also the typecheck) and runs
  `node --test` on `test/*.test.js`.
- `.githooks/pre-commit` runs lint, then tests, then gitleaks on the staged diff, and refuses
  the commit if gitleaks isn't installed. Wire it with `npm run hooks`. We can't use a `prepare`
  script: n8n's lint bans lifecycle scripts.
- CI (`.github/workflows/ci.yml`) runs gitleaks over the git history, lint and `npm test` on
  every PR and push to `main`.

## 2. Technology

TypeScript on `@n8n/node-cli`, scaffolded from its `declarative/custom` template. n8n's
verification requires the CLI's structure, TypeScript, MIT, and zero runtime dependencies;
`n8n-workflow` is a peer dependency the n8n instance provides.

## 3. Module shape

One package, one service:

- `credentials/MailflossApi.credentials.ts`: API key sent as a Bearer header, tested with
  `GET /v1/check-key`.
- `nodes/Mailfloss/`: the action node, programmatic style. Declarative style sends one request
  per input item; Start batch must combine all input items into one job, and Get Results walks a
  cursor. `GenericFunctions.ts` holds the single request helper both nodes use.
- `nodes/MailflossTrigger/`: the webhook trigger. n8n requires triggers to be programmatic.

## 4. Testing strategy

The test boundary is `this.helpers.httpRequestWithAuthentication`. Tests build a fake node
context, script the API responses, and assert on the requests sent and items returned. Nothing
touches the network, and there is no test database. Live behavior is checked by hand in a
local n8n with a real API key before each release.

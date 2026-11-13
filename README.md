# @kadmo/n8n-nodes-kadmo

This is an n8n community node package: the **Kadmo** node and the **Kadmo Trigger** node. It lets you use [Kadmo](https://kadmo.ai) in your n8n workflows.

Kadmo runs AI agents on your team's work: an agent picks up a task, works through a playbook, opens pull requests and asks a person when it needs one. With this package an n8n workflow can start that work — dispatch a job, file a task, run a playbook on a task — and read it back.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

- [Installation](#installation)
- [Operations](#operations)
- [Trigger](#trigger)
- [Credentials](#credentials)
- [Usage](#usage)
- [Limits and retries](#limits-and-retries)
- [Troubleshooting](#troubleshooting)
- [Compatibility](#compatibility)
- [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation and install `@kadmo/n8n-nodes-kadmo`.

## Operations

The **Kadmo** node:

| Resource | Operation | What it does |
|---|---|---|
| Job | Dispatch | Queues a workflow in a workspace. An agent of the account takes it; the job starts as `queued`. |
| Job | Get | Reads a job: its status, its agent, its playbook run, the question it waits on and, once finished, its result. |
| Task | Create | Files a task in the workspace's tracker (or as a Kadmo task) and adds it to Kadmo's Tasks as `pending`. It does not start. |
| Task | Get | Reads a task with its status, its playbook and its runs. |
| Task | Run Playbook | Approves a task with a playbook. The run starts when nothing holds it (a task it depends on, a full pool, a step only a person can do). |

- **Workspace**, **Workflow** and **Playbook** are picked from lists read from your Kadmo account, or named by slug or name.
- When you pick a workflow, its **Inputs** appear: required inputs are marked as such, and an input left empty takes the workflow's default. **Extra Inputs** sends inputs by name, for a workflow chosen by an expression; an empty value is left out there too.
- **Simplify** (on by default) returns the ten fields a workflow usually needs. Turn it off for the whole object as Kadmo answers it.
- **Run Playbook** answers in two ways: with the run when it started at once, or with `run: null` and `waiting_on` (the reason) when it waits. Use an If node on `run` to tell them apart, then a Kadmo Trigger or a Get to follow it.
- The node can be used as a tool by an AI Agent node.

## Trigger

The **Kadmo Trigger** node starts a workflow when something happens in Kadmo.

| Trigger On | Sent |
|---|---|
| Job Finished | A job succeeded, failed or was cancelled. Sent 30 seconds to 10 minutes after the end, once the job's report and files have arrived. |
| Job Needs Input | A job waits on a person: a question, a plan or an approval. Sent 2 minutes after the ask, only if it is still open. |
| Task Done | A task's run resolved it, or closed it with nothing to do. Sent at once. |

Pick one or more events and, optionally, a **Workspace** to receive only its events.

**Publishing subscribes, unpublishing unsubscribes.** When the workflow is published, the node subscribes its webhook URL in Kadmo (it appears under **Integrations › Outgoing webhooks**, owned by the token's member); when it is unpublished, the subscription is deleted.

**Each delivery is checked.** Kadmo signs every delivery with a secret given to this subscription only. The node checks the signature and the timestamp (within 5 minutes) on the bytes received; a delivery that does not match is answered 401 and starts nothing.

**Testing.** Kadmo's events come seconds to minutes after the fact, and n8n listens for a test event for 2 minutes. To see the connection work at once: click **Listen for test event**, then in Kadmo open **Integrations › Outgoing webhooks** and click **Send test** on the subscription. A `ping` event arrives (its `data` is empty). On a published workflow a ping is acknowledged and starts nothing.

**The output** is the event as Kadmo sends it: `id`, `type`, `api_version`, `created_at`, `webhook_id` and `data.job` (a Job, as Job › Get answers it) or `data.task` (a Task).

**Good to know:**

- **A public https address.** Kadmo only calls a public `https` address. n8n Cloud has one. A self-hosted n8n must be reachable from the internet: set `N8N_WEBHOOK_URL` to its public https address (or put a tunnel in front of it). Publishing on `http://localhost` is refused with a message that says so.
- **At least once, in any order.** A delivery that timed out is sent again with the same `id`, and events can arrive out of order. Drop repeats with n8n's **Remove Duplicates** node on `{{ $json.id }}`.
- **A disabled subscription.** If this n8n refuses or misses every delivery for 24 hours (or answers 410), Kadmo disables the subscription and mails its owner. Turn it back on with **Enable** in Kadmo, or unpublish and publish the workflow again.
- **The token.** Revoking the API token later does not stop deliveries: the subscription belongs to the member and is signed with its own secret. Delete it in Kadmo, or unpublish the workflow before revoking the token.

### Example: tell a channel when a job finishes

1. **Kadmo Trigger**: Trigger On `Job Finished`.
2. **If** `{{ $json.data.job.status }}` is `succeeded`.
3. **Slack** › Send Message: `{{ $json.data.job.workflow }} finished: {{ $json.data.job.result.summary }} — {{ $json.data.job.url }}`.

### Example: hand a question to a person

1. **Kadmo Trigger**: Trigger On `Job Needs Input`.
2. **Send Email**: `{{ $json.data.job.needs_input.question }}`, with a link to `{{ $json.data.job.needs_input.url }}`, where it is answered.

## Credentials

You need a Kadmo account and an API token.

1. In Kadmo, open **Settings › Assistant › API tokens** and create a token. It starts with `kadmo_api_` and is shown once.
2. In n8n, create a **Kadmo API** credential:
   - **API Token**: the token.
   - **Base URL**: the address of your Kadmo app, `https://app.kadmo.ai` unless your team runs its own.
3. Save. n8n tests the credential with a call that reads who the token belongs to.

The token acts as the member who made it, with that member's role. Revoking it in Kadmo stops every workflow that uses it at the next call.

## Usage

### File a task and start work on it

1. **Kadmo** › Task › Create: Workspace `main`, Title from the previous node.
2. **Kadmo** › Task › Run Playbook: Task Key `{{ $json.key }}`, Playbook `bug-fix`.
3. **If** `{{ $json.run }}` is empty: the run waits (`{{ $json.waiting_on.reason }}`) and starts on its own.

### Dispatch a job from a form

1. **n8n Form Trigger** with a field `Ticket URL`.
2. **Kadmo** › Job › Dispatch: Workspace `main`, Workflow `se-work`, Inputs › `ticket_url` = `{{ $json['Ticket URL'] }}`.
3. The answer carries the job's `id` and its `url` in Kadmo.

### Check on a job

**Kadmo** › Job › Get with the Job ID from Dispatch. `status` is one of `queued`, `running`, `needs_input`, `succeeded`, `failed`, `cancelled`. While it is `needs_input`, `question` holds what the agent asks; it is answered on the job's page in Kadmo (`url`).

## Limits and retries

- **Rate limit.** Kadmo allows 120 calls a minute per API token. When Kadmo answers that the limit is reached, the node waits as long as Kadmo asks (up to 20 seconds, 3 times) and tries again. For large batches put a Wait node in the loop.
- **No double work on a retry.** Every create, dispatch and run the node sends carries an `Idempotency-Key` made of the execution, the node, the run and the item. If n8n's **Retry On Fail** sends the call again in the same execution, Kadmo answers with its first answer instead of filing a second ticket or queuing a second job. A refusal is replayed the same way. A new execution, another item or a loop's next run gets a new key. Set **Idempotency Key** under Additional Fields to use your own (Kadmo keeps it 24 hours).
- When the node runs as an AI tool, each call of the tool is a new run and gets a new key.

## Troubleshooting

Every refusal shows Kadmo's own sentence and, under it, what to do. The common ones:

| Kadmo says | What to do |
|---|---|
| The token is not valid (`unauthorized`) | Use an API token (`kadmo_api_…`), not an MCP or Git token, and check that it was not revoked. |
| The trial has ended (`trial_expired`) | The API still reads; it starts work again once the account has a plan. |
| No credit or budget left (`no_credit`, `budget_reached`) | Add credit or raise the budget in Kadmo under Settings › Billing. |
| Not found (`workspace_not_found`, `workflow_not_found`, …) | Pick the workspace, workflow or playbook from the list: a disabled one is not found. |
| Already running (`duplicate_job`, `run_active`) | Nothing new was started; the answer names the work under way. |
| The Base URL does not serve the API | Use the address of the Kadmo app itself, such as `https://app.kadmo.ai`, without a path. |

## Compatibility

Built and tested with n8n 2.47 (`n8n-workflow` 2.47) and Kadmo API v1.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Kadmo API](https://docs.kadmo.ai/api/overview)
- [Kadmo API contract (OpenAPI 3.1)](https://app.kadmo.ai/api/v1/openapi.json)

## License

[MIT](LICENSE)

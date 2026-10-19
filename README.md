# @transpareo/n8n-nodes-transpareo

[![npm](https://img.shields.io/npm/v/@transpareo/n8n-nodes-transpareo)](https://www.npmjs.com/package/@transpareo/n8n-nodes-transpareo)
[![licence](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)

[n8n](https://n8n.io) nodes for [Transpareo](https://transpareo.com): work
with the products, components, Digital Product Passports, lots and tasks
of a Transpareo workspace from an n8n workflow, and start workflows when
a passport is published, recalled or voided, or when records are created
or changed.

The package holds three nodes:

- **Transpareo** reads and writes products, components, passports, lots
  and tasks.
- **Transpareo Trigger** starts a workflow the moment a passport
  registers a version. Transpareo calls n8n through a signed webhook.
- **Transpareo Polling Trigger** checks the workspace on a schedule for
  new or changed products, components and passports, and for passport
  events. It suits an n8n that Transpareo cannot reach from the internet.

[Installation](#installation) ·
[Credentials](#credentials) ·
[Operations](#operations) ·
[Triggers](#triggers) ·
[Example workflows](#example-workflows) ·
[Compatibility](#compatibility) ·
[Development](#development)

## Installation

In n8n, open **Settings**, then **Community Nodes**, choose **Install**
and enter `@transpareo/n8n-nodes-transpareo`. On a self-hosted n8n the
command line works too, in n8n's nodes folder, followed by a restart
of n8n:

```sh
mkdir -p ~/.n8n/nodes
npm install --prefix ~/.n8n/nodes @transpareo/n8n-nodes-transpareo
```

n8n's guide covers the details:
<https://docs.n8n.io/integrations/community-nodes/installation/>.

## Credentials

The nodes connect as an API consumer of your workspace, with the OAuth
2.0 client credentials grant the
[Transpareo API](https://demo.transpareo.com/apidocs/guide) uses.

1. In the application manager of your workspace, open **API consumers**
   and create one. Add it to an access group that grants the
   permissions the workflows need (see the table below). The application manager shows the secret once; copy
   it.
2. In n8n, create a **Transpareo API** credential with:
   - **Workspace Address**: the address of your workspace, such as
     `https://acme.example.com`, without a path.
   - **Client ID**: the key of the API consumer.
   - **Client Secret**: its secret.
3. Save. n8n tests the credential by asking the workspace what the
   consumer may do, and the test fails while it may do nothing at all.
   A call the consumer holds no permission for fails with the
   workspace's answer, which names the permission to add.

The credential exchanges the client id and secret for a token, which
lives one hour, and fetches a new one by itself when the workspace no
longer accepts the old one. Suspending the consumer in the application
manager, or regenerating its secret, stops every workflow that uses it
at the next request.

| What the workflow does | Permissions |
|---|---|
| Read or write products | `product_access`, and `brand_access` to create a brand by name |
| Read or write components | `component_access` or `component_write` |
| Read passports, their requirements and lots | `dpp_read` |
| Create, update or validate passports | `dpp_write` |
| Publish or correct passports | `dpp_write` and `dpp_publish` |
| Append events | `dpp_events`; a sealed status change also `dpp_publish` |
| Update dynamic data | `dpp_dynamic` |
| Read a passport's events, or poll the event feed | `dpp_history` |
| Reissue passports | `dpp_lifecycle` and `dpp_write` |
| Read or create tasks | `task_access` |
| Use the Transpareo Trigger | `webhook_access` and `dpp_history` |

### Errors

A refused call shows the workspace's own message and code as the
error, such as `Reading these records needs the product_access
permission. (PRODUCT_FORBIDDEN)`. The details below it name each field
the workspace refused with its own message and code, the workspace's
hint and the reference page of the code. An AI Agent that uses the
node as a tool reads the same message and details, so it can tell the
person what to change.

## Operations

| Resource | Operations |
|---|---|
| Product | Create, Get, Get Many, Update |
| Component | Create, Get, Get Many, Update |
| Passport | Append Event, Correct, Create, Get, Get Events, Get Many, Get Requirements, Get Versions, Publish, Reissue, Update, Update Dynamic Data, Validate |
| Lot | Get, Get Many |
| Task | Create, Get, Get Assignees, Get Many |

Notes on a few of them:

- **Get Many** returns up to a limit, or every record with **Return
  All**. Filters include a search term, **Created Since**, **Updated
  Since** and the order (newest first, or recently updated first).
- **Product Create** names the brand and the components by name; a
  name the workspace does not know yet creates the brand or the
  component. **Properties** take one row per value, with the property
  types the workspace defines listed by name. A variant names its
  parent under **Variant Of (Product ID)** and needs a name alone.
- **Passport** operations find a passport from a list, by its ID, or
  by the code printed on its label, the one webhook deliveries name.
- **Get Requirements** tells which identifiers a passport of a product
  needs and what a publish would report today. **Validate** checks a
  passport as a publish would, without writing it. Both are worth a
  step before **Create** and **Publish**.
- **Publish** signs the passport and registers a version. A published
  passport cannot be taken back: its signed snapshot is archived and
  its address may already be printed on a label.
- **Append Event** with the type **Status Change** and the status
  **Suspended** is how a unit in the field is recalled. Its passport
  keeps answering a scan, so whoever holds the unit learns of the
  recall.
- **Task Create** asks a person or an access group for something,
  optionally about one product, component, passport or lot. Tasks are
  decided by people in the application manager.

Voiding and superseding a passport, deleting records and the
storefront's publication of products and components are left out of
these nodes. n8n's HTTP Request node reaches them with the same
credential.

## Triggers

### Transpareo Trigger

Starts the workflow when a passport registers a version: published,
recalled, rolled back, a lifecycle transition, repair, refurbished,
collected, recycled, voided, superseded, reissued or corrected. Pick
the events, or none for all of them, and optionally the passports by
code.

Activating the workflow subscribes n8n's webhook address in the
workspace, named after the workflow; deactivating it removes the
subscription. Every delivery carries the signature
`X-Transpareo-Signature`; the trigger checks it with the secret the
workspace issued for the subscription and runs nothing for a delivery
whose signature does not hold. The workflow receives the delivery as
sent:

```json
{
  "id": "68bea2f8a3c1d40011e5f0b2",
  "type": "published",
  "dpp_code": "A1B2C3D4E",
  "occurred_at": "2026-10-18T09:12:44Z",
  "data": { "version": 3 }
}
```

Transpareo delivers to public `https` addresses only, and an API
consumer holds at most ten subscriptions. An n8n reached on a private
address uses the polling trigger instead.

### Transpareo Polling Trigger

Checks the workspace at the interval set on the node:

- **Product Created**, **Component Created**, **Passport Created**: the
  records created since the last check.
- **Product Updated**, **Component Updated**, **Passport Updated**: the
  records created or changed since the last check. A passport counts as
  changed when its own fields are edited, and scans leave it alone. To
  follow publishes, recalls and the other steps of its life, use
  **Passport Event** or the Transpareo Trigger.
- **Passport Event**: every event a passport records, the twelve above
  and inspections, incidents, ownership transfers and the like,
  optionally narrowed to event types or one passport.

The first activation starts watching from that moment, so a workflow
never replays what existed before it. **Fetch Test Event** shows the
newest record, or a passport event of the past day. Each
check reads every page of what changed and hands the records to the
workflow oldest first, each once.

## Example workflows

**Tell the shop team when a passport is published.** Transpareo
Trigger with the event **Published**, then Transpareo with Passport,
Get, By Code `{{ $json.dpp_code }}`, then a Slack or email node with
the passport's address. [examples/passport-published.json](examples/passport-published.json)
imports it.

**Issue a passport for every new product.** Transpareo Polling Trigger
with **Product Created**; Transpareo with Passport, Validate, Product
By ID `{{ $json.id }}`; an IF node on `{{ $json.valid }}`; Transpareo
with Passport, Create and then Publish, By Code
`{{ $json.code }}`.

**Ask quality to check a recalled unit.** Transpareo Trigger with the
event **Lifecycle Transition**; Transpareo with Passport, Get, By Code
`{{ $json.dpp_code }}`; an IF node on `{{ $json.status }}` being
`suspended`; Transpareo with Task, Create, assigned to the quality
group, subject type Passport and subject ID `{{ $json.id }}`.

## Compatibility

Built and tested with n8n 2.43 (`n8n-workflow` and `n8n-core`
2.43.5), and needs n8n 2.10 or later. The action node reads every
failed answer itself except a 401, on which n8n renews the token; an
n8n before 2.10 cannot set the 401 apart and would stop renewing the
token after its first hour. The nodes carry no runtime dependencies.

## Development

```sh
mise install          # Node 24, as pinned in mise.toml
npm install
npm run build
npm run lint          # n8n's own lint for community nodes
npm test              # the nodes run through n8n's workflow engine
npm run dev           # n8n on http://localhost:5678 with these nodes
```

`npm test` never touches the network: the routing of the action node
runs in n8n's own engine against a recorded workspace. `npm run
test:e2e` runs the nodes against a real workspace and skips unless a
consumer is configured:

```sh
export TRANSPAREO_TEST_HOST=<workspace address>
export TRANSPAREO_TEST_CLIENT_ID=<key>
export TRANSPAREO_TEST_CLIENT_SECRET=<secret>
npm run test:e2e
```

It reads, validates, and creates one webhook subscription, which it
removes again. Releases are published to npm from the `Publish`
workflow of this repository through npm trusted publishing, with a
provenance statement.

## Licence

MIT, see [LICENSE](LICENSE). The Transpareo name and logo are covered
by [TRADEMARKS.md](TRADEMARKS.md). Report security issues to
<n8n@transpareo.com>.

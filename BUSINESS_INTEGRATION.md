# Calas Business Integration Blueprint

This document turns the repository set around `calasdan-sketch` into an efficient operating system for a business, without collapsing every experimental repo into one fragile monolith.

## Goal

Build a production-ready business platform that can:

- capture leads from the website and phone intake
- route leads into sales/support workflows
- automate operations with AI agents
- maintain shared memory and contextual state across the business
- keep research, security tooling, and experimental repositories isolated from customer-facing production traffic

## Design principle

Use a layered, hub-and-spoke architecture.

Do not make one giant repo or one giant app. Instead:

- keep each repo as a domain or service
- connect them through APIs, events, and shared identifiers
- centralize business state in a single operational layer
- use AI memory and workflow state services to coordinate agent activity

## Production repo grouping

### 1) Revenue and customer acquisition

- `calas-site` — website, landing pages, demos, revenue funnel
- `lead-me` — B2B lead intelligence and outreach orchestration
- `calas-reception` — AI phone receptionist / intake system
- `AIReceptionist` — open-source inbound phone assistant capability

These form the front door of the business.

Recommended flow:

1. website or phone captures a lead
2. a normalized lead record is created in a central business system
3. lead is scored and classified
4. qualified leads are routed to sales or onboarding
5. a customer record is created once a lead becomes active

### 2) Customer operations

- `libredesk` — support desk / customer communication
- `documenso` — proposals, contracts, signatures
- `activepieces` — workflow automation
- `watchpost` — operational monitoring and security visibility

These support service delivery and trust.

### 3) AI coordination layer

- `claude-bridge` — shared AI state across local and remote Claude surfaces
- `mem0` — persistent memory layer for AI agents
- `hindsight` — agent memory learning and recall
- `codebase-memory-mcp` — repo and codebase intelligence for internal operations
- `univer` — workspace/productivity layer when operationally useful

These are not customer-facing apps by themselves; they are the intelligence and coordination layer for internal systems.

### 4) Research and non-production repos

- `system_prompts_leaks`
- security and exploitation-oriented repos
- experimental AI / hacking / scraping / research repos
- sketch or concept repos

These should remain isolated from live business workloads unless they are explicitly converted into vetted production services.

## Recommended operating model

### Core business service

Create a new central service with a narrow mandate:

- customer records
- tenant/company records
- lead pipeline states
- call logs and messages
- support ticket relationships
- proposal / contract status
- workflow triggers
- audit log and permissions

This service becomes the system of record, not the individual repos.

### Shared data contracts

The services should exchange just a few core objects:

- Customer
- Organization
- Lead
- Opportunity
- Contact
- Ticket
- Contract
- WorkflowEvent
- AgentMemoryRecord

Each record should include:

- id
- tenant_id
- owner_id
- status
- source
- created_at
- updated_at
- external_ref

This normalization prevents each repo from owning a different model of the same customer or lead.

### Event-driven integration

Use a lightweight event bus or queue:

- lead.created
- lead.qualified
- call.incoming
- support.ticket.created
- proposal.sent
- contract.signed
- alert.generated

These events allow services to stay independent while still staying coordinated.

## AI memory approach

The AI layer should not be scattered across every repo.

Use a single memory layer:

- `claude-bridge` as the cross-surface state store
- `mem0` or `hindsight` as the long-term learning layer
- `codebase-memory-mcp` for code and operational context
- a single namespace per tenant or workflow

Important rule:

- front-end and operational services must read/write through the business core
- AI memory should be contextual, not duplicated across isolated tools

## Security and governance

Before exposing any of this to customers or real operations, add the following:

- tenant isolation
- role-based access control
- API auth and scoped tokens
- rate limiting
- audit logs
- secret management
- environment separation (dev/staging/prod)
- backups and recovery
- dependency vetting for any repos connected to production

## What not to do

Do not:

- merge every repo into one giant application
- use prototype research repos as live backend services
- allow one repo to write directly to another without a business boundary
- treat `system_prompts_leaks` as runtime logic or business-critical infrastructure
- run everything on one shared filesystem or one unmanaged state store

## Recommended implementation sequence

### Phase 1: business core

Build the central orchestration layer that manages:

- customer / lead lifecycle
- workflow states
- alerts and tasks
- permissions
- API integration endpoints

### Phase 2: acquisition flow

Connect:

- `calas-site`
- `lead-me`
- `calas-reception`
- `AIReceptionist`

into the business core using standardized lead records.

### Phase 3: service operations

Connect:

- `libredesk`
- `documenso`
- `watchpost`
- `activepieces`

### Phase 4: AI coordination

Connect:

- `claude-bridge`
- `mem0`
- `hindsight`
- `codebase-memory-mcp`

and expose only the business-critical functions to the internal tools.

### Phase 5: hardening

- add observability
- add deployment automation
- add backups
- verify tenant boundaries
- run smoke tests across the whole stack

## Efficient end-state architecture

```text
Website / Calls / Leads
        ↓
Business Core (source of truth)
        ├─ Sales / CRM logic
        ├─ Support / tickets
        ├─ Contracts / approvals
        ├─ Security / monitoring
        └─ AI coordination layer
                ├─ claude-bridge
                ├─ mem0
                ├─ hindsight
                └─ codebase-memory-mcp
```

This gives you a functioning business system without the operational cost of a monolith.

## Recommended repo priorities

Priority order:

1. `calas-site`
2. `lead-me`
3. `calas-reception`
4. `AIReceptionist`
5. `libredesk`
6. `documenso`
7. `watchpost`
8. `activepieces`
9. `claude-bridge`
10. `mem0` / `hindsight` / `codebase-memory-mcp`

Everything else stays optional, isolated, or research-oriented.

## Bottom line

The efficient integration is not “all repos at once.”

The efficient integration is:

- central business core
- standardized domain models
- event-driven service boundaries
- shared AI memory
- strict isolation for research and non-production code

This is the cleanest way to turn your repo set into an actual operating business system.

## Next step

The next concrete step is to create the `business-core` service and define the normalized schemas for:

- lead
- customer
- ticket
- contract
- workflow event
- agent memory record

Once those are in place, the rest of the repos can be connected cleanly and efficiently.

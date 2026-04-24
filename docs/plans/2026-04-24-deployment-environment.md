# Deployment Environment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make ForumMagnum run locally against a hosted PostgreSQL instance with the smallest viable dependency set, then prepare the codebase and docs for the first hosted runtime experiment.

**Architecture:** First simplify runtime assumptions locally, especially config loading and bootstrap flow. Then verify the local app against hosted Postgres with search disabled and non-essential integrations unset. Only after that should the work move to hosted app deployment.

**Tech Stack:** Node.js 24+, Next.js 16, PostgreSQL 15+ with `pgvector`, shell scripts, Railway or Fly for infrastructure, GitHub-hosted source.

---

### Task 1: Audit and codify the minimum runtime contract

**Files:**
- Modify: `docs/deployment-notes.md`
- Modify: `docs/plans/2026-04-24-deployment-environment-design.md`
- Test: manual verification of referenced startup/config paths

**Step 1: Write down the minimum required runtime inputs**

List the exact variables and files needed for stage 1:

- `PG_URL`
- `ENV_NAME`
- local settings JSON path
- `private_expressSessionSecret`
- `public.disableElastic`

**Step 2: Verify each claimed dependency against the code**

Run:

```bash
rg -n "PG_URL|ENV_NAME|expressSessionSecret|disableElastic" packages app scripts
```

Expected: direct references showing these settings are genuinely used.

**Step 3: Update the deployment notes**

Add a short "Stage 1 minimum runtime" section to `docs/deployment-notes.md`.

**Step 4: Re-read for scope creep**

Check that the section does not promise login, editor support, email, or search.

**Step 5: Commit**

```bash
git add docs/deployment-notes.md docs/plans/2026-04-24-deployment-environment-design.md
git commit -m "docs: define minimum deployment runtime"
```

### Task 2: Add a direct local startup path that does not depend on Vercel env pull

**Files:**
- Create: `scripts/runHostedDbDev.sh`
- Modify: `package.json`
- Modify: `docs/deployment-notes.md`
- Test: local startup command output

**Step 1: Write the failing manual check**

Try to explain the current startup path without Vercel:

```bash
sed -n '1,220p' scripts/runDevInstance.sh
```

Expected: it still depends on `vercel env pull`, proving a separate script is justified.

**Step 2: Create a minimal startup script**

Create `scripts/runHostedDbDev.sh` that:

- requires `PG_URL`
- requires `ENV_NAME`
- optionally loads `.env.local`
- starts `next dev` directly
- avoids Vercel env pull entirely

**Step 3: Add a package script**

Add a script such as:

```json
"start-hosted-db-dev": "scripts/runHostedDbDev.sh"
```

**Step 4: Run the script with missing env vars**

Run:

```bash
yarn start-hosted-db-dev
```

Expected: a clean, explicit failure message about missing required env vars.

**Step 5: Commit**

```bash
git add scripts/runHostedDbDev.sh package.json docs/deployment-notes.md
git commit -m "scripts: add direct hosted-db dev startup"
```

### Task 3: Create a stage-1 local config example

**Files:**
- Create: `sample_settings.stage1.json`
- Modify: `docs/deployment-notes.md`
- Test: JSON validation by inspection and local build/start use

**Step 1: Write the failing comparison**

Inspect the existing sample:

```bash
sed -n '1,220p' sample_settings.json
```

Expected: it is generic and does not document a stage-1 deployment profile.

**Step 2: Create `sample_settings.stage1.json`**

Include:

- basic public branding
- `siteUrl`
- `forumType`
- `analytics.environment`
- `disableElastic: true`
- any other public settings needed specifically for stage 1

**Step 3: Document how it is used**

Add usage notes showing how this file pairs with `ENV_NAME` and `private_*` env vars.

**Step 4: Sanity-check the file**

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('sample_settings.stage1.json','utf8')); console.log('ok')"
```

Expected: `ok`

**Step 5: Commit**

```bash
git add sample_settings.stage1.json docs/deployment-notes.md
git commit -m "docs: add stage-1 settings example"
```

### Task 4: Prove blank managed database bootstrap

**Files:**
- Modify: `docs/deployment-notes.md`
- Optional create: `scripts/bootstrapHostedDb.sh`
- Test: remote database bootstrap commands

**Step 1: Write the failing operational check**

Attempt bootstrap manually against a fresh managed database using:

```bash
psql "$PG_URL" -f ./schema/accepted_schema.sql
yarn migrate up
```

Expected: either full success or a concrete failure that reveals the missing bootstrap step.

**Step 2: Record the authoritative order**

Document whether the working sequence is:

- schema import only
- migrations only
- schema import then migrations

**Step 3: If the sequence is non-trivial, script it**

Create `scripts/bootstrapHostedDb.sh` that:

- checks `PG_URL`
- loads the schema
- runs migrations
- exits clearly on failure

**Step 4: Re-run against a fresh database**

Expected: repeatable success without ad hoc fixes.

**Step 5: Commit**

```bash
git add docs/deployment-notes.md scripts/bootstrapHostedDb.sh
git commit -m "scripts: document hosted database bootstrap"
```

### Task 5: Verify stage-1 local runtime against hosted Postgres

**Files:**
- Modify: `docs/deployment-notes.md`
- Optional create: `docs/checklists/stage1-smoke-test.md`
- Test: manual smoke tests

**Step 1: Define the smoke-test checklist**

Cover:

- app boots locally
- homepage renders
- a post page renders
- GraphQL route responds
- no hard failure from disabled search

**Step 2: Run the smoke test**

Use the real local startup path and hosted DB connection.

**Step 3: Capture failures precisely**

For each failure, record:

- exact route
- exact error
- missing dependency or config cause

**Step 4: Update the docs**

Add a short "Known blockers after stage 1 smoke test" section.

**Step 5: Commit**

```bash
git add docs/deployment-notes.md docs/checklists/stage1-smoke-test.md
git commit -m "docs: add stage-1 smoke test checklist"
```

### Task 6: Prepare the first hosted runtime experiment

**Files:**
- Create: `docs/plans/2026-04-24-hosted-runtime-followup.md`
- Optional modify: `Dockerfile`
- Optional create: provider-specific config such as `fly.toml` or Railway notes
- Test: deployment dry run only after stage 1 is green

**Step 1: Choose the hosted runtime target after evidence**

Decision rule:

- choose Railway if simplicity remains best
- choose Fly if runtime/process separation becomes more important

**Step 2: Write the smallest hosted runtime checklist**

Include:

- source deployment path
- env var injection
- secrets handling
- health check route
- rollback path

**Step 3: Document deferred features explicitly**

Defer:

- OAuth beyond one provider
- editor-rich authoring
- image uploads
- Elasticsearch
- full cron coverage

**Step 4: Only then attempt hosted deployment**

Run the platform-specific deployment steps chosen in Step 1.

**Step 5: Commit**

```bash
git add docs/plans/2026-04-24-hosted-runtime-followup.md Dockerfile fly.toml
git commit -m "docs: prepare hosted runtime follow-up"
```

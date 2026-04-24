# Deployment Environment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make ForumMagnum run locally against a hosted PostgreSQL instance with the smallest viable dependency set, then prepare the codebase and docs for the first hosted runtime experiment.

**Architecture:** First simplify runtime assumptions locally, especially config loading and bootstrap flow. Then verify the local app against hosted Postgres with search disabled and non-essential integrations unset. Only after that should the work move to hosted app deployment.

**Tech Stack:** Node.js 24+, Next.js 16, PostgreSQL 15+ with `pgvector`, shell scripts, Railway or Fly for infrastructure, GitHub-hosted source.

---

### Task 1: Build the runtime dependency matrix

**Files:**
- Modify: `docs/plans/2026-04-24-deployment-environment-design.md`
- Modify: `docs/deployment-notes.md`
- Test: manual verification of startup-adjacent integrations

**Step 1: List startup-adjacent integrations**

Start with:

- database connection
- search
- auth/session
- CKEditor
- Cloudinary
- Mailgun
- Intercom
- language-model integrations

**Step 2: Verify their unset behavior in code**

Run:

```bash
rg -n "expressSessionSecret|disableElastic|ckEditor|cloudinary|mailgun|intercom|openAIApiKey|oAuth" packages app scripts
```

Expected: enough references to classify each dependency.

**Step 3: Write a runtime dependency matrix**

For each integration, record:

- startup blocker?
- route blocker?
- feature-only blocker?
- can defer?

**Step 4: Add the matrix summary to the docs**

Document the dependencies that must be present before any boot attempt.

**Step 5: Commit**

```bash
git add docs/plans/2026-04-24-deployment-environment-design.md docs/deployment-notes.md
git commit -m "docs: add runtime dependency matrix"
```

### Task 2: Audit and codify the minimum runtime contract

**Files:**
- Modify: `docs/deployment-notes.md`
- Modify: `docs/plans/2026-04-24-deployment-environment-design.md`
- Test: manual verification of referenced startup/config paths

**Step 1: Write down the minimum required runtime inputs**

List the exact variables and files needed for stage 1:

- `PG_URL`
- `ENV_NAME`
- one explicit public-config strategy:
  - add a new code-backed `ENV_NAME` profile, or
  - add dev support for a local public settings file
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

### Task 3: Verify provider connectivity and bootstrap contract

**Files:**
- Modify: `docs/deployment-notes.md`
- Create: `scripts/checkLocalPrereqs.sh`
- Optional create: `scripts/checkHostedDbConnection.sh`
- Modify: `package.json`
- Test: remote database connectivity commands

**Step 1: Verify local prerequisites**

Run:

```bash
yarn check-local-prereqs
```

Expected: confirms `node`, `psql`, and `railway` are available locally.

**Step 2: Provision the correct Railway database service**

Document the exact stage-1 path:

- use Railway
- select the `pgvector` Postgres path, not plain Postgres
- authenticate with `railway login`
- retrieve the public connection string and export it as `PG_URL`

**Step 3: Verify external connectivity to the hosted database**

Run:

```bash
psql "$PG_URL" -c 'select version();'
```

Expected: successful local connection to the managed database.

**Step 4: Verify extension support**

Run:

```bash
psql "$PG_URL" -c 'create extension if not exists vector;'
```

Expected: success, or a provider-specific error that disqualifies the stage-1 database choice.

**Step 5: Record SSL and connectivity requirements**

Document:

- whether SSL is required
- any required connection-string parameters
- whether local access is stable enough for daily development

**Step 6: Script the prereq and connectivity checks**

Create:

- `scripts/checkLocalPrereqs.sh`
- `scripts/checkHostedDbConnection.sh`

And wire them into `package.json` for repeatable use.

**Step 7: If the connectivity checks are non-trivial, keep them scripted**

Create `scripts/checkHostedDbConnection.sh` that validates:

- `PG_URL` is set
- local connectivity works
- the required extension is available

**Step 8: Commit**

```bash
git add docs/deployment-notes.md scripts/checkLocalPrereqs.sh scripts/checkHostedDbConnection.sh package.json
git commit -m "docs: codify hosted database connectivity"
```

### Task 4: Add a direct local startup path that does not depend on Vercel env pull

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

Observed result:

- the direct startup path works with explicit `PG_URL`, `ENV_NAME=stage1Lw`, `FORUM_TYPE=LessWrong`, and `private_expressSessionSecret`
- it avoids `vercel env pull` entirely

**Step 5: Commit**

```bash
git add scripts/runHostedDbDev.sh package.json docs/deployment-notes.md
git commit -m "scripts: add direct hosted-db dev startup"
```

### Task 5: Make the public config strategy real

**Files:**
- Modify: `packages/lesswrong/server/settings/settings.ts`
- Optional create: a new settings module under `packages/lesswrong/server/settings/`
- Modify: `docs/deployment-notes.md`
- Test: local startup uses the intended stage-1 config path

**Step 1: Write the failing design check**

Inspect:

```bash
sed -n '1,260p' packages/lesswrong/server/settings/settings.ts
```

Expected: the current local runtime uses `ENV_NAME`-selected code-backed settings, not an arbitrary JSON file.

**Step 2: Choose one explicit path**

Preferred:

- add a new code-backed stage-1 `ENV_NAME` profile

Alternative:

- add explicit dev support for loading a local public settings file

**Step 3: Implement the smallest viable path**

Do not add both unless the code strongly justifies it.

**Step 4: Verify the chosen config path is actually used at runtime**

Run the local startup path and confirm the expected public settings are visible.

Observed result:

- the `stage1Lw` profile is used for baseline overrides, including `disableElastic=true`
- the runtime still loads `publicSettings` from the database and merges in `sharedSettings`
- that means the current stage-1 proof demonstrates runtime viability, not full product isolation

Follow-up implication:

- if we want a neutral staging identity later, we will need either a scrubbed seed database or a stronger override strategy for database-backed public settings

**Step 5: Commit**

```bash
git add packages/lesswrong/server/settings/settings.ts packages/lesswrong/server/settings docs/deployment-notes.md
git commit -m "feat: add stage-1 public config path"
```

### Task 6: Prove blank managed database bootstrap

**Files:**
- Modify: `docs/deployment-notes.md`
- Optional create: `scripts/bootstrapHostedDb.sh`
- Test: remote database bootstrap commands

**Step 1: Write the failing operational check**

Attempt bootstrap manually against a fresh managed database using:

```bash
psql "$PG_URL" -f ./schema/accepted_schema.sql
yarn migrate up dev lw
```

Expected: either full success or a concrete failure that reveals the missing bootstrap step.

**Step 2: Record the authoritative order**

Document whether the working sequence is:

- schema import only
- migrations only
- schema import then migrations
- schema import plus a repo-specific migration wrapper with environment/forum arguments

**Step 3: If the sequence is non-trivial, script it**

Create `scripts/bootstrapHostedDb.sh` that:

- checks `PG_URL`
- loads the schema
- runs migrations using a valid repo command
- exits clearly on failure

**Step 4: Re-run against a fresh database**

Expected: repeatable success without ad hoc fixes.

**Step 5: Commit**

```bash
git add docs/deployment-notes.md scripts/bootstrapHostedDb.sh
git commit -m "scripts: document hosted database bootstrap"
```

### Task 7: Verify stage-1 local runtime against hosted Postgres

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
- one auth-adjacent route degrades cleanly or is explicitly documented as unsupported
- one editor-adjacent route degrades cleanly or is explicitly documented as unsupported
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

### Task 8: Prepare the first hosted runtime experiment

**Files:**
- Create: `docs/plans/2026-04-24-hosted-runtime-followup.md`
- Optional modify: `Dockerfile`
- Optional create: provider-specific config such as `fly.toml` or Railway notes
- Test: deployment dry run only after stage 1 is green

**Step 1: Choose the hosted runtime target after evidence**

Decision rule:

- choose Railway if Dockerfile deployment, env injection, and health-checking are simple enough and cross-provider DB latency remains acceptable
- choose Fly if runtime/process separation, future worker model, and app/database colocation matter more than keeping the fewest platform concepts

**Step 2: Write the smallest hosted runtime checklist**

Include:

- source deployment path
- env var injection
- secrets handling
- health check route
- rollback path
- whether the Dockerfile still assumes credentials or build-time secrets we do not want
- whether scheduled work can be added later without changing the base deployment model

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

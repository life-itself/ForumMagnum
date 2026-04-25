# Hosted Runtime Follow-Up

## Goal

Prepare the first remote app deployment after the stage-1 proof of:

- local app runtime
- hosted Railway `pgvector` database
- schema-only bootstrap

This document is intentionally narrower than a full staging plan. It defines the smallest credible hosted-runtime experiment and the blockers that must be removed first.

## Recommendation

Use Railway for the first hosted app runtime experiment as well, because:

- the database is already there
- the project/service model is simpler than adding a second platform immediately
- the first remote goal is operational proof, not platform comparison theater

Do not treat that as a permanent platform choice yet. It is the shortest path to the next piece of evidence.

## Current Baseline

What is already proven:

- Railway `pgvector` Postgres works from a local machine
- the app boots locally against that hosted DB
- the stage-1 startup path avoids `vercel env pull`
- the hosted DB bootstrap path is repeatable

What is not yet proven:

- a container image can build and boot cleanly on a hosted platform
- realistic content rendering works, because the current stage-1 DB is schema-only and has no `Posts` rows

What is now proven locally after the follow-up work:

- a production-style build can run without the private credentials repo by using `yarn build-hosted-db`
- a built app can start locally against the Railway DB by using `yarn start-hosted-db`
- `/`, `/login`, and `/graphql` respond under that production-style local runtime

## Hosted Runtime Decision

Choose Railway first for the remote app if all of the following stay true:

- the container can build without cloning a private credentials repo
- env var and secret injection can replace the current credentials-repo assumptions
- the app can boot with explicit stage-1 config and a direct `PG_URL`
- health checking is straightforward

Revisit Fly only if we hit platform friction around process model, networking, or future background-worker separation.

## Confirmed Blockers

### 1. The checked-in production path is not deployable as-is

[`scripts/runProduction.sh`](/Users/rgrp/src/ForumMagnum/scripts/runProduction.sh) clones a private credentials repo and then builds from `./Credentials/$SETTINGS_FILE_NAME`.

That is incompatible with the current self-hosting direction.

Implication:

- the first hosted runtime cannot use `yarn run production` unchanged
- use the explicit self-hosted pair instead:
  - `yarn build-hosted-db`
  - `yarn start-hosted-db`

### 2. The Dockerfile is now aligned to the self-hosted runtime contract

[`Dockerfile`](/Users/rgrp/src/ForumMagnum/Dockerfile) now:

- uses Node `24.13.0`
- builds with `yarn build-hosted-db`
- starts with `yarn start-hosted-db`

This works for Railway because service variables are available during both the build process and at runtime.

Implication:

- the first Railway app deployment can use the Dockerfile directly, provided the required variables are defined on the app service before deploy

### 3. The current hosted DB is schema-only

The stage-1 Railway database currently has `0` rows in `Posts`.

Implication:

- a remote app boot can still be useful
- but realistic read-path validation will require either:
  - a seeded content snapshot, or
  - targeted fixture inserts

## Minimum Hosted Runtime Contract

The first remote app deployment should use:

- `PG_URL`
- `ENV_NAME=stage1Lw`
- `FORUM_TYPE=LessWrong`
- `private_expressSessionSecret`
- any additional `private_*` secrets that prove to be startup blockers

It should explicitly avoid:

- private credentials repo cloning
- Vercel env pull
- Elasticsearch
- OAuth setup
- full cron coverage

## Smallest Credible Remote-App Path

1. Build the container with Node `24.13.0`
2. Replace the current container runtime command with an explicit startup command that does not depend on `scripts/runProduction.sh`
3. Inject stage-1 env vars directly in Railway
4. Point the app service at the existing Railway `pgvector` database
5. Verify:
   - app process starts
   - homepage responds
   - GraphQL responds
   - login route responds
6. Treat missing post content as expected until the DB is seeded

## Suggested Implementation Sequence

### Task A: Create a hosted-runtime entrypoint

Add a script specifically for hosted app runtime that:

- does not clone credentials
- requires `PG_URL` and `ENV_NAME`
- starts the built app directly

Status:

- complete in repo as `scripts/buildHostedDb.sh`
- complete in repo as `scripts/runHostedDbProduction.sh`
- exposed as `yarn build-hosted-db` and `yarn start-hosted-db`
- validated locally against the Railway database

### Task B: Make the Dockerfile use the new entrypoint

Update the image so the default command matches the self-hosted contract rather than the legacy credentials-repo contract.

Status:

- complete in repo
- Dockerfile now builds with `yarn build-hosted-db`
- Dockerfile now starts with `yarn start-hosted-db`

### Task C: Dry-run the environment contract locally

Before remote deployment, prove that the same env set works for:

- local production-style build
- local `next start`

Suggested command pair:

```bash
PG_URL='postgres://...' \
ENV_NAME=stage1Lw \
private_expressSessionSecret='replace-me' \
yarn build-hosted-db

PG_URL='postgres://...' \
ENV_NAME=stage1Lw \
private_expressSessionSecret='replace-me' \
PORT=8080 \
yarn start-hosted-db
```

Status:

- complete
- the build initially failed during page-data collection for `/auth/linkgdrive`
- the fix was to lazy-load `google-auth-library` inside the route handler instead of importing it at module scope
- the first remote Docker build then failed because `eslint-plugin-local` is a file dependency and the Dockerfile was not copying it before `yarn install`
- the Dockerfile has been updated to copy `eslint-plugin-local` before dependency installation

### Task D: Deploy to Railway app runtime

Only after Tasks A-C are green.

Current blocker:

- the linked Railway project only contains the `pgvector` database service
- `railway up --service forum-magnum-app` currently fails with `Service not found`
- in this environment, the Railway CLI exposes service management for existing services but not app-service creation
- so the next deploy attempt requires creating a separate app service in the Railway project first, then targeting that service with the existing build/start contract

## Deferred Features

Explicitly not in scope for the first remote app deployment:

- OAuth login
- editor-rich authoring
- image uploads
- seeded production-like content
- Elasticsearch
- cron parity

## Success Criteria

The first hosted-runtime experiment is successful if:

- the app service boots remotely
- it connects to the existing Railway DB
- `/`, `/login`, and `/graphql` respond
- the runtime contract is documented without any private credentials repo dependency

That is enough evidence to justify the next stage: seeding content, then validating real read paths, then enabling one login path.

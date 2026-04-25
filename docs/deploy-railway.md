# Deploy To Railway

This is the clean operational guide for the current Railway deployment path.

It is intentionally shorter than the ongoing notes and plan docs.

For full history, rationale, and intermediate discoveries, see:

- [deployment-notes.md](/Users/rgrp/src/ForumMagnum/docs/deployment-notes.md)
- [2026-04-24-deployment-environment.md](/Users/rgrp/src/ForumMagnum/docs/plans/2026-04-24-deployment-environment.md)
- [2026-04-24-hosted-runtime-followup.md](/Users/rgrp/src/ForumMagnum/docs/plans/2026-04-24-hosted-runtime-followup.md)

Once the deployment is fully working, this file should become the main distilled guide and some of the material above can be trimmed back to design/history.

## Current State

What is already working:

- Railway project exists: `forummagnum-stage1`
- Railway database service exists: `pgvector`
- Railway app service exists: `forum-magnum-app`
- app service variables can be set entirely from CLI
- local app runtime works against the Railway database
- local production-style build/start works against the Railway database

What is not fully working yet:

- the Railway app deployment is still failing after app build completes
- the repeated failure boundary is Dockerfile-based image import/handoff on Railway,
  not project/service creation or app compilation

## Clean-Slate Railway Flow

### 1. Log In

```bash
railway login
```

### 2. Create Or Link The Project

If the project does not exist yet:

```bash
railway init -n forummagnum-stage1
```

Do not create duplicate projects.

### 3. Add The Database Service

Use the Railway `pgvector` template in the dashboard.

Do not use plain Railway Postgres for this stage.

### 4. Create The App Service

This can be done from CLI:

```bash
railway add -s forum-magnum-app
```

This creates a new service inside the existing project. It does not create a new project.

### 5. Set App Service Variables

```bash
railway variable set -s forum-magnum-app --skip-deploys \
  'PG_URL=${{pgvector.DATABASE_URL_PRIVATE}}' \
  'ENV_NAME=stage1Lw' \
  'FORUM_TYPE=LessWrong' \
  'private_expressSessionSecret=replace-me' \
  'PORT=8080' \
  'NODE_OPTIONS=--no-deprecation --max_old_space_size=2560'
```

Notes:

- `PG_URL=${{pgvector.DATABASE_URL_PRIVATE}}` keeps app-to-DB traffic inside Railway
- replace `private_expressSessionSecret` with a real random value

### 6. Deploy The App

```bash
railway up --service forum-magnum-app --ci
```

This repo now carries Railway deployment config in
[railway.json](/Users/rgrp/src/ForumMagnum/railway.json). The intended Railway
path is:

- `RAILPACK` builder
- explicit build command for CKEditor, codegen, and `next build`
- explicit start command for `next start`
- healthcheck on `/api/health`

Important nuance:

- the CLI may time out client-side during the upload handoff
- Railway can still continue the deployment in the background

So after `railway up`, always verify separately with:

```bash
railway service status -s forum-magnum-app --json
railway logs -s forum-magnum-app --latest --build --lines 200
```

## Current Known Blockers

As of the latest attempt:

- service creation works
- service variable wiring works
- deployment submission works
- the remaining failures are specifically on Railway's Dockerfile deployment
  path after build completion
- one resolved container-build failure was missing `ckEditor/build/ckeditor`
  during `next build`; the build command now runs `cd ckEditor && yarn build`
  before `yarn generate` and `next build`
- another observed failure mode was Railway's builder dropping with
  `rpc error: code = Unavailable desc = error reading from server: EOF`
  during highly parallel static generation; the repo now caps Next build
  parallelism in `next.config.ts`
- another concrete deploy defect was that the Docker context included a local
  `.next/` directory that was about `2.6G`; [`.dockerignore`](/Users/rgrp/src/ForumMagnum/.dockerignore)
  now excludes `.next` and `tmp` so Docker-based local builds only use source,
  not stale local build artifacts
- because Railway will always prefer a root `Dockerfile` when present, the local
  Docker preflight image now lives at
  [Dockerfile.local](/Users/rgrp/src/ForumMagnum/Dockerfile.local) and Railway
  deployment is being moved to Railpack via
  [railway.json](/Users/rgrp/src/ForumMagnum/railway.json)

That means the next Railway experiment is not another Dockerfile tweak. It is a
builder-path change away from Dockerfile auto-detection.

## Recommended Iteration Loop

Use this loop until the first deploy succeeds:

1. reproduce the app build locally or with `Dockerfile.local` when useful
2. keep Railway on the Railpack path defined in `railway.json`
3. retry `railway up`
4. inspect Railway status and build logs

At the moment, the intended Railway build order is:

1. `yarn install`
2. `cd ckEditor && yarn build`
3. `ENV_NAME=stage1Lw FORUM_TYPE=LessWrong yarn generate`
4. `ENV_NAME=stage1Lw FORUM_TYPE=LessWrong next build`

The hosted-build tuning currently also includes:

- `experimental.cpus = 4`
- `experimental.staticGenerationMaxConcurrency = 4`

Those are there to reduce build fan-out on Railway after the builder dropped
mid-build during large static generation.

For the local preflight flow, see:

- [deploy-local-with-docker.md](/Users/rgrp/src/ForumMagnum/docs/deploy-local-with-docker.md)

## Smoke Checks After First Success

Once Railway reports a successful app deployment, check:

- `/`
- `/login`
- `/graphql`

Expected caveat:

- the current database bootstrap is schema-only and has no `Posts` rows
- so realistic content routes may still be sparse or empty until content is seeded

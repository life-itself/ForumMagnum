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
- Railway app service is online
- Railway app URL is `https://forum-magnum-app-production.up.railway.app`
- app service variables can be set entirely from CLI
- local app runtime works against the Railway database
- local production-style build/start works against the Railway database
- hosted app deployment works on Railway via Railpack

What is not fully working yet:

- behavior verification is still pending
- we have not yet confirmed the live route behavior beyond service-online status

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

## Working Deployment Notes

The first successful hosted deployment uses:

- Railway project `forummagnum-stage1`
- Railway DB service `pgvector`
- Railway app service `forum-magnum-app`
- app URL `https://forum-magnum-app-production.up.railway.app`
- `RAILPACK` builder
- [`railway.json`](/Users/rgrp/src/ForumMagnum/railway.json) for build/start/healthcheck
- [`railpack.json`](/Users/rgrp/src/ForumMagnum/railpack.json) for Railpack install-step override

The key fixes that got this green were:

- move Railway off the root Dockerfile path
- one resolved container-build failure was missing `ckEditor/build/ckeditor`
  during `next build`; the build command now runs `cd ckEditor && yarn build`
  before `yarn generate` and `next build`
- on Railpack, `ckEditor` also needs its own dependency install step because the
  root package install does not populate `ckEditor/node_modules`; the build
  command in [railway.json](/Users/rgrp/src/ForumMagnum/railway.json) now runs
  `cd ckEditor && yarn install --frozen-lockfile --ignore-scripts --ignore-optional`
  before the editor build
- Railway's build config also now sets
  `RAILPACK_INSTALL_COMMAND=yarn install --frozen-lockfile --ignore-scripts --ignore-optional`
  on the service to cut unnecessary optional/native install work from the root
  dependency phase
- the repo now also includes
  [railpack.json](/Users/rgrp/src/ForumMagnum/railpack.json) to override
  Railpack's generated `install` step directly with
  `yarn install --frozen-lockfile --ignore-scripts`, because the service-level
  env override alone was not reliably reflected in build logs
- we cannot drop optional dependencies from the root install because
  `@swc/core` relies on an optional Linux binary package during `yarn generate`
- we also cannot leave all install scripts disabled without compensation,
  because `bcrypt` needs its native binding built; the Railway build command now
  runs `npm rebuild bcrypt` before codegen/build
- the successful Railway path is no longer blocked on Dockerfile image import
- the remaining work is smoke-testing and runtime-behavior validation, not
  getting the service online
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

That means the deployment problem is now narrowed from "can we get it online?"
to "what works correctly on the live service?"

## Recommended Iteration Loop

Use this loop for repeatable redeploys:

1. reproduce the app build locally or with `Dockerfile.local` when useful
2. keep Railway on the Railpack path defined in `railway.json`
3. retry `railway up`
4. inspect Railway status and build logs

At the moment, the intended Railway build order is:

1. `yarn install`
2. Railpack install step uses `yarn install --frozen-lockfile --ignore-scripts`
3. `npm rebuild bcrypt`
4. `cd ckEditor && yarn install --frozen-lockfile --ignore-scripts --ignore-optional`
5. `cd ckEditor && yarn build`
6. `ENV_NAME=stage1Lw FORUM_TYPE=LessWrong yarn generate`
7. `ENV_NAME=stage1Lw FORUM_TYPE=LessWrong next build`

The hosted-build tuning currently also includes:

- `experimental.cpus = 4`
- `experimental.staticGenerationMaxConcurrency = 4`

Those are there to reduce build fan-out on Railway after the builder dropped
mid-build during large static generation.

For the local preflight flow, see:

- [deploy-local-with-docker.md](/Users/rgrp/src/ForumMagnum/docs/deploy-local-with-docker.md)

## Next Verification

With the service online, the next checks are:

- `/`
- `/login`
- `/graphql`
- `/api/health`

Expected caveat:

- the current database bootstrap is schema-only and has no `Posts` rows
- so realistic content routes may still be sparse or empty until content is seeded

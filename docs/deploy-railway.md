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

- the Railway app deployment is still failing during the container build
- current failure point is in the Docker image build path, not in Railway project/service setup
- the current concrete failure was that Railway did not have a usable CKEditor
  bundle in image build context, so the image now builds CKEditor explicitly

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
- the remaining failures are container-build failures inside the app repo path
- one resolved container-build failure was missing `ckEditor/build/ckeditor`
  during `next build`; the Dockerfile now runs `cd ckEditor && yarn build`
  before `yarn generate` and `next build`

That means Railway itself is no longer the main unknown.

## Recommended Iteration Loop

Use this loop until the first deploy succeeds:

1. reproduce the container build locally with Docker
2. fix the local build failure
3. retry `railway up`
4. inspect Railway status and build logs

At the moment, the image build order should be understood as:

1. `yarn install`
2. `cd ckEditor && yarn build`
3. `ENV_NAME=stage1Lw FORUM_TYPE=LessWrong yarn generate`
4. `ENV_NAME=stage1Lw FORUM_TYPE=LessWrong next build`

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

# ForumMagnum Self-Hosted Deployment Notes

## Core Requirements

| Component | Requirement |
|-----------|------------|
| **Runtime** | Node.js >= 24.13.0 |
| **Database** | PostgreSQL 15+ with `pgvector` extension |
| **Framework** | Next.js 16 (built-in) |
| **Port** | 8080 (default) |

## Minimal Deployment Steps

1. **Set up PostgreSQL** with pgvector, then initialize from `schema/accepted_schema.sql`
2. **Configure runtime**:
   - `PG_URL` — database connection string
   - `ENV_NAME` — environment identifier used to select code-backed public settings in `packages/lesswrong/server/settings/settings.ts`
   - Private settings via `private_*` prefixed env vars (see `packages/lesswrong/server/databaseSettings.ts` for the full list)
   - If you want a custom public config outside the built-in `ENV_NAME` profiles, you must add explicit code support for it first
3. **Build & run**:
   ```bash
   yarn install
   yarn generate
   yarn build --settings ./your-settings.json --production
   yarn run production
   ```
4. **Run migrations**: use the repo's migration wrapper with environment and forum arguments, e.g. `yarn migrate up dev lw`
5. **Set up cron jobs** — the app expects periodic hits to `/api/cron/every-minute`, `/api/cron/every-hour`, `/api/cron/every-midnight`, etc. (defined in `vercel.json`)

## Stage 1 Minimum Runtime

For the first self-hosted proof, target the smallest viable setup:

- Local app runtime
- Hosted PostgreSQL with `pgvector`
- Direct local connectivity to the database, including any required SSL parameters
- `PG_URL`
- `ENV_NAME=stage1Lw`
- `private_expressSessionSecret`
- Search explicitly disabled with `public.disableElastic=true` in the selected public settings profile

At this stage, do not assume:

- a custom local public settings JSON is already supported
- OAuth is required
- Elasticsearch is required
- Mailgun is required
- Cloudinary is required for first boot
- CKEditor authoring flows need to work

What stage 1 has actually proven so far:

- the app boots locally against a hosted Railway `pgvector` Postgres database
- the homepage, `/login`, `/newPost`, and `/graphql` all respond against that hosted DB
- a simple GraphQL query for `currentUser` returns `null` cleanly when no login flow is configured
- the stage-1 profile is sufficient for a runtime proof, not for a clean-room product identity

Important stage-1 constraint:

- after startup, the app loads database-backed `publicSettings` from Postgres
- the stage-1 profile also inherits a large `sharedSettings` baseline
- so even with `ENV_NAME=stage1Lw`, many production-style public values can still appear unless they are explicitly overridden or scrubbed from the seed database
- for now, that is acceptable because the current milestone is runtime viability, not final staging isolation
- the schema bootstrap path does not seed forum content such as posts; it gives us structure and settings, not a populated forum dataset

## Local Prerequisites

Before attempting stage 1 from a laptop, verify the local toolchain:

- Node.js `>=24.13.0`
- `psql`
- Railway CLI

Checks:

```bash
yarn check-local-prereqs
```

Typical macOS install path:

```bash
brew install libpq
brew install railway
echo 'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"' >> ~/.zshrc
```

Then restart the shell or reload the profile before rerunning the check.

## Railway Stage 1 Setup

For the first hosted database proof, use Railway's `pgvector` Postgres path rather than the standard Postgres template.

Suggested flow:

1. Install and authenticate the Railway CLI:
   ```bash
   railway login
   ```
2. Create or select exactly one Railway project.
3. Add the `pgvector` template directly to that project.
   Do not add standard Postgres first and expect to enable `pgvector` later.
4. Retrieve the external connection string for the `pgvector` service and export it locally as `PG_URL`.
   In our case, Railway exposed the correct external URL as `DATABASE_URL`.
5. Validate local connectivity:
   ```bash
   yarn check-hosted-db
   ```

What to record once this is working:

- which Railway template/service path was used
- whether the public connection string requires SSL parameters
- the exact variable name Railway exposes for the public DB URL
- any local-shell setup needed to make `psql` available

The first goal is not to automate the entire Railway project lifecycle. It is to make the database setup and local connectivity steps explicit and repeatable.

### Railway-specific learnings from the first run

- Railway's standard Postgres service is not the correct stage-1 choice for this repo; use the `pgvector` template directly.
- The Railway CLI was able to create and link the project, but not provision the `pgvector` template by code.
  For now, the reliable path is to add the `pgvector` service from the dashboard/template flow.
- The Railway CLI can create the app service directly once the project already exists:
  `railway add -s forum-magnum-app`
- On the free plan, accidentally creating a second project can block service creation because of project limits.
  Keep the workflow to one project, verify the project ID, then add services inside it.
- The repo is linked to Railway by project ID in `~/.railway/config.json`.
- The deployed `pgvector` service exposed:
  - `DATABASE_URL` for external access
  - `DATABASE_URL_PRIVATE` for Railway-internal access
- `railway connect` is not enough on its own; a local Postgres client such as `psql` is still required for bootstrap and verification
- The app service can reference the database service's private URL with Railway variable syntax:
  `PG_URL=${{pgvector.DATABASE_URL_PRIVATE}}`

## Stage 1 Commands

Local prerequisite check:

```bash
yarn check-local-prereqs
```

Hosted DB connectivity check:

```bash
PG_URL='postgres://...' yarn check-hosted-db
```

Hosted DB bootstrap:

```bash
PATH="/opt/homebrew/opt/libpq/bin:$PATH" \
PG_URL='postgres://...' \
yarn bootstrap-hosted-db
```

Bootstrap behavior:

- on a fresh DB, `yarn bootstrap-hosted-db` loads `schema/accepted_schema.sql`
- then it marks schema-backed migrations as executed using the repo's migration storage
- on a non-fresh DB, it skips schema import and runs the normal migration wrapper with explicit local env injection

This repo should not replay the entire historical migration chain immediately after loading `schema/accepted_schema.sql` into a blank database.

Observed first-run verification:

- schema import succeeded against Railway `pgvector`
- marking migrations as executed recorded the repo migration set without replaying historical transforms
- a follow-up `yarn migrate up dev lw` with explicit env injection applied `0 migrations`
- the hosted DB had `0` rows in `Posts` after schema bootstrap, confirming that this path is schema-only and not a content seed

Direct local startup against hosted DB:

```bash
PATH="/opt/homebrew/opt/libpq/bin:$PATH" \
PG_URL='postgres://...' \
ENV_NAME=stage1Lw \
private_expressSessionSecret='replace-me' \
yarn start-hosted-db-dev
```

Hosted build and production-style start against hosted DB:

```bash
PATH="/opt/homebrew/opt/libpq/bin:$PATH" \
PG_URL='postgres://...' \
ENV_NAME=stage1Lw \
private_expressSessionSecret='replace-me' \
yarn build-hosted-db

PATH="/opt/homebrew/opt/libpq/bin:$PATH" \
PG_URL='postgres://...' \
ENV_NAME=stage1Lw \
private_expressSessionSecret='replace-me' \
PORT=8080 \
yarn start-hosted-db
```

Observed hosted-runtime dry run:

- `yarn build-hosted-db` completed successfully against the Railway DB
- `yarn start-hosted-db` booted the built app locally on port `8080`
- `/` responded with HTTP `200`
- `/login` responded with HTTP `200`
- `/graphql` responded to `currentUser` with `{"data":{"currentUser":null}}`
- the previous build blocker on `/auth/linkgdrive` was resolved by lazy-loading `google-auth-library` inside the route handler instead of importing it at module scope

Clean-slate Railway app-service setup:

```bash
railway add -s forum-magnum-app

railway variable set -s forum-magnum-app --skip-deploys \
  'PG_URL=${{pgvector.DATABASE_URL_PRIVATE}}' \
  'ENV_NAME=stage1Lw' \
  'FORUM_TYPE=LessWrong' \
  'private_expressSessionSecret=replace-me' \
  'PORT=8080' \
  'NODE_OPTIONS=--no-deprecation --max_old_space_size=2560'

railway up --service forum-magnum-app --ci
```

Successful hosted Railway deployment checkpoint:

- project: `forummagnum-stage1`
- DB service: `pgvector`
- app service: `forum-magnum-app`
- app URL: `https://forum-magnum-app-production.up.railway.app`
- app service status: `SUCCESS`
- working deploy path: `RAILPACK` via [`railway.json`](/Users/rgrp/src/ForumMagnum/railway.json)
- Railpack install override: [`railpack.json`](/Users/rgrp/src/ForumMagnum/railpack.json)

Live hosted smoke-check checkpoint:

- `/api/health` returned HTTP `200`
- `/` returned HTTP `200`
- `/login` returned HTTP `200`
- `/graphql` returned `{"data":{"currentUser":null}}` for an anonymous request

The working hosted build path is now:

1. Railpack root install with `yarn install --frozen-lockfile --ignore-scripts`
2. `npm rebuild bcrypt`
3. `cd ckEditor && yarn install --frozen-lockfile --ignore-scripts --ignore-optional`
4. `cd ckEditor && yarn build`
5. `ENV_NAME=stage1Lw FORUM_TYPE=LessWrong yarn generate`
6. `ENV_NAME=stage1Lw FORUM_TYPE=LessWrong ./node_modules/.bin/next build`

The important strategic conclusion is that Railway's Dockerfile path was the
wrong path for this repo. The first successful hosted deployment came only after
switching the service to Railpack and making the build/runtime contract explicit.

Documentation status:

- concise rerun instructions now live in [deploy-railway.md](/Users/rgrp/src/ForumMagnum/docs/deploy-railway.md)
- local Docker preflight instructions live in [deploy-local-with-docker.md](/Users/rgrp/src/ForumMagnum/docs/deploy-local-with-docker.md)
- this file remains the longer running notebook of what was tried and what was learned

Notes:

- `railway add -s forum-magnum-app` creates the app service inside the already-linked project; it does not create a new project
- the deploy may time out client-side during the upload handoff, but Railway can still continue the deployment in the background

Container/runtime alignment:

- the Dockerfile now uses Node `24.13.0`
- the Dockerfile builds with `yarn build-hosted-db`
- the Dockerfile starts with `yarn start-hosted-db`
- for Railway, the required service variables must be present before deploy because the build step consumes them

## Runtime Dependency Matrix

This is the current stage-1 assessment based on code inspection. It should be treated as a working matrix and updated after the first real smoke test.

| Integration | Unset behavior | Stage-1 classification |
|-------------|----------------|------------------------|
| PostgreSQL / `PG_URL` | Core DB access fails | Hard startup blocker |
| Public settings via `ENV_NAME` | App falls back or misconfigures if invalid | Hard startup/config blocker |
| `private_expressSessionSecret` | Sessions/auth are unsafe or broken | Hard runtime blocker |
| Elasticsearch | Can be disabled with `disableElastic=true` | Deferable if explicitly disabled |
| OAuth providers | Login paths unavailable | Route/feature blocker only |
| Mailgun | Send paths fail soft when client is missing | Feature-only blocker |
| Intercom | Client is only created if token exists | Feature-only blocker |
| Cloudinary | Upload and some rich media flows degrade | Feature/route blocker, not startup blocker |
| CKEditor cloud/editor services | Editor-adjacent flows may fail or degrade | Route/feature blocker, not yet proven startup blocker |
| OpenAI and related AI integrations | AI features unavailable | Feature-only blocker |

Smoke-test status from the first hosted-DB run:

- homepage: passes
- homepage content state: renders "No posts to display."
- `/login`: passes
- `/account`: passes while logged out
- `/newPost`: passes at route-load level
- `/graphql`: passes for a simple unauthenticated query
- authenticated behavior: unauthenticated requests degrade cleanly to `currentUser: null`

Known blockers after the first smoke test:

- the tested post route returned HTTP `200`, but the server logged `app.missing_document` during resolver execution because the schema-only bootstrap produced no `Posts` rows
- `/newPost` loads, but authoring is not yet validated
- the stage-1 profile is still influenced by database-backed `publicSettings` and code-backed `sharedSettings`
- if we want realistic read-path testing, we need a seeded content snapshot or targeted fixture inserts as a separate step

## External Services (by importance)

### Required for stage 1

- **PostgreSQL with `pgvector`**
- **Express session secret** — for auth sessions

### Deferred for stage 1 unless proven otherwise

- **Elasticsearch** — powers site search (`packages/lesswrong/server/search/elastic/`), but can likely be disabled for first boot
- **CKEditor Cloud** — the rich text editor needs cloud credentials (environment ID, secret key, API key), but authoring is not part of the first proof

### Required for auth (pick at least one)

- Google OAuth (`googleClientId` / `googleOAuthSecret`)
- GitHub OAuth
- Facebook OAuth

### Strongly recommended

- **Cloudinary** — image hosting/transformation
- **Mailgun** — transactional email
- **reCAPTCHA** — bot protection
- **Sentry** — error tracking

### Optional / feature-specific

- Recombee (ML recommendations)
- Stripe (donations/fundraising)
- Google Maps / Mapbox (location features)
- Intercom (support widget)
- CloudFront (CDN caching layer)
- OpenAI API key (AI features)

## Deployment Options

The codebase currently deploys to **Vercel** (primary) with a separate **Fly.io** instance for the Hocuspocus real-time collaboration server. But it also has a `Dockerfile` you can use for container-based deployment (Docker, ECS, Kubernetes, etc.):

- `Dockerfile` — main app container, exposes port 8080
- `fly/hocuspocusServer/` — separate collaboration server (WebSocket-based)

## Key Gotchas

- The Dockerfile references a private `Credentials` repo decrypted via `transcrypt` — you'd replace that with your own settings mechanism.
- `yarn generate` must be run after any schema/GraphQL changes before building.
- The local runtime public config comes from code-backed `ENV_NAME` settings, not an arbitrary JSON file.
- Railway's standard Postgres path is not the stage-1 target here; use the `pgvector` variant so extension support is not a surprise later.
- Railway project duplication can waste limited free-plan quota and block setup; keep to one linked project.
- The forum type (LessWrong, AlignmentForum, EA Forum) is configured in settings — you'd likely want to customize this or create your own.
- Memory: production startup sets `--max_old_space_size=2560` (2.5GB).
- Connection pooling: `PG_MAX_CONNECTIONS` defaults to 25 per instance.

## Key Files to Study

| File | Purpose |
|------|---------|
| `sample_settings.json` | Settings structure |
| `packages/lesswrong/server/settings/settings.ts` | How settings are loaded |
| `packages/lesswrong/server/databaseSettings.ts` | All configurable private settings |
| `scripts/runProduction.sh` | Production startup logic |
| `Dockerfile` | Container reference |
| `vercel.json` | Cron job definitions you'd need to replicate |
| `schema/accepted_schema.sql` | Full database schema |
| `packages/lesswrong/server/search/elastic/README.md` | Elasticsearch setup |

## Settings File Structure

The checked-in settings example (`sample_settings.json`) shows the shape of public config:

```json
{
  "public": {
    "forumType": "LessWrong",
    "title": "ForumMagnum",
    "siteUrl": "http://localhost:3000",
    "forumSettings": {
      "headerTitle": "ForumMagnum",
      "shortForumTitle": "FM",
      "tabTitle": "ForumMagnum"
    }
  }
}
```

Private settings are provided via environment variables with a `private_` prefix (e.g. `private_languageModels_openai_apiKey`). Nested keys use underscores as separators.

For local stage-1 work, do not assume this JSON file is loaded automatically. The current local runtime selects public settings from code via `ENV_NAME`.

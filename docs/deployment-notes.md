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
- `ENV_NAME`
- `private_expressSessionSecret`
- Search explicitly disabled with `public.disableElastic=true` in the selected public settings profile

At this stage, do not assume:

- a custom local public settings JSON is already supported
- OAuth is required
- Elasticsearch is required
- Mailgun is required
- Cloudinary is required for first boot
- CKEditor authoring flows need to work

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
2. Create or select a Railway project.
3. Add a PostgreSQL service with `pgvector`.
4. Retrieve the external connection string for the database service and export it locally as `PG_URL`.
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

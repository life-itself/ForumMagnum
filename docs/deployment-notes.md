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
2. **Configure settings** — create a settings JSON file (see `sample_settings.json`) and set environment variables, especially:
   - `PG_URL` — database connection string
   - `ENV_NAME` — environment identifier
   - Private settings via `private_*` prefixed env vars (see `packages/lesswrong/server/databaseSettings.ts` for the full list)
3. **Build & run**:
   ```bash
   yarn install
   yarn generate
   yarn build --settings ./your-settings.json --production
   yarn run production
   ```
4. **Run migrations**: `yarn migrate up` (uses `PG_URL`)
5. **Set up cron jobs** — the app expects periodic hits to `/api/cron/every-minute`, `/api/cron/every-hour`, `/api/cron/every-midnight`, etc. (defined in `vercel.json`)

## External Services (by importance)

### Required for basic operation

- **Elasticsearch** — powers site search (`packages/lesswrong/server/search/elastic/`)
- **CKEditor Cloud** — the rich text editor needs cloud credentials (environment ID, secret key, API key)
- **Express session secret** — for auth sessions

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

The settings file (`sample_settings.json`) has a `public` section for client-visible config:

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

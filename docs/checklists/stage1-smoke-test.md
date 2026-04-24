# Stage 1 Hosted-DB Smoke Test

Use this checklist after starting the app locally against the hosted database with:

```bash
PATH="/opt/homebrew/opt/libpq/bin:$PATH" \
PG_URL='postgres://...' \
ENV_NAME=stage1Lw \
FORUM_TYPE=LessWrong \
private_expressSessionSecret='replace-me' \
yarn start-hosted-db-dev
```

## Checks

- [x] App boots locally against the hosted Railway `pgvector` database
- [x] Homepage responds with HTTP 200 at `/`
- [x] GraphQL responds to an unauthenticated query at `/graphql`
- [x] Auth-adjacent routes respond with HTTP 200 at `/login` and `/account`
- [x] Editor-adjacent route responds with HTTP 200 at `/newPost`
- [x] Search-disabled stage-1 profile does not prevent basic route loads
- [ ] A real post page renders cleanly without server resolver errors or missing seed data

## Commands Used In The First Run

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
curl -sS -X POST http://127.0.0.1:3000/graphql \
  -H 'content-type: application/json' \
  --data '{"query":"query { currentUser { _id } }"}'
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/login
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/account
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/newPost
curl -sS -o /dev/null -w '%{http_code}\n' \
  http://127.0.0.1:3000/posts/B6CxEApaatATzown6/the-lesswrong-2022-review
```

## First-Run Results

| Check | Result | Notes |
|------|--------|-------|
| App boot | Pass | `yarn start-hosted-db-dev` starts Next.js against Railway DB |
| Homepage | Pass | `/` returned `200` and rendered "No posts to display." |
| GraphQL | Pass | `currentUser` query returned `{"data":{"currentUser":null}}` |
| Login route | Pass | `/login` returned `200` |
| Account route | Pass | `/account` returned `200` while logged out |
| New post route | Pass with warning | `/newPost` returned `200`; server logged a non-blocking Yjs duplicate-import warning |
| Post route | Blocked | `/posts/B6CxEApaatATzown6/the-lesswrong-2022-review` returned `200`, but server logged `app.missing_document` because the schema-only bootstrap produced no `Posts` rows |

## Known Blockers After First Run

- Post-page verification is not clean yet.
  The tested post route responded at the HTTP layer, but the server logged `app.missing_document`, so content-level correctness is still unproven.
- The hosted DB is schema-only after bootstrap.
  Direct inspection showed `0` rows in `Posts`, so realistic read-path testing needs seeded content.
- The stage-1 profile is not a clean-room environment.
  Database-backed `publicSettings` and code-backed `sharedSettings` still inject production-style values unless explicitly overridden.
- Editor flows are only route-level verified.
  `/newPost` loads, but authoring itself is not yet validated.

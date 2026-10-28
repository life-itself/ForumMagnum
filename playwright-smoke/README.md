# Smoke tests for the deployed forum

Browser checks of the live Seeds of Renaissance forum (issue #37). They're separate from the upstream suite in `playwright/`, which runs against a local test database.

```
yarn playwright install chromium   # once
yarn smoke-test                    # against https://forum.seedsofrenaissance.org
SMOKE_BASE_URL=http://localhost:3456 yarn smoke-test
```

## What they check

**Always (read-only):**
- The home page, a post page (including its image from Cloudinary), All Posts, Concepts, a tag page, About, FAQ, Contact and the login form all load.
- Search finds posts and tags.
- Old Discourse links redirect: topic, reply, category, upload, profile, and an unknown topic.
- No console errors, and no requests to LessWrong or third-party services (Typekit, Intercom, LogRocket, …).

**With a test account (writes, cleaned up afterwards):**
- Log in.
- Create a draft, edit it, and delete it.
- Comment and reply on a test post, upvote it and take the vote back, then delete the comments.

## Test account setup (once)

1. **Make an account.** Sign up as a normal member, e.g. `smoketest`, with an email you control. Don't make it an admin.
2. **Approve it as an admin** in the moderation sidebar, so its posts and comments aren't held for review.
3. **Create a test post as an admin.** Title it e.g. "Smoke test post (please ignore)". Then, in the editor's settings sidebar:
   - turn on **Make only accessible via link** (Admin Controls);
   - turn on **Allow rate-limited users to comment freely on this post** (Moderation), so the test account isn't held to new members' comment limits;
   - publish.
4. **Run with:**
   ```
   SMOKE_USERNAME=smoketest SMOKE_PASSWORD=… SMOKE_TEST_POST_ID=<the test post's id> yarn smoke-test
   ```

Without these variables, the account tests are skipped.

## Notes
- Tests run one at a time, so a run doesn't load the site.
- `KNOWN` in `smokeUtils.ts` lists the migrated content the tests rely on (a post with an image, old topic IDs, a tag). Update it if that content changes.
- Hydration warnings and the browser's `requestStorageAccess` message are ignored: upstream LessWrong logs them too, and they aren't failures.

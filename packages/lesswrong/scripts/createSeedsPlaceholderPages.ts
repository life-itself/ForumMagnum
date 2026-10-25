import { Posts } from "@/server/collections/posts/collection";
import { Users } from "@/server/collections/users/collection";
import { createPost } from "@/server/collections/posts/mutations";
import { computeContextFromUser } from "@/server/vulcan-lib/apollo-server/context";

/* eslint-disable no-console */

/**
 * Creates placeholder About, FAQ and Contact posts for the Seeds deployment
 * (issue #25), so those menu links stop returning 404 until the real content is
 * written. The posts are unlisted and hidden from Recent Discussion, so they
 * only appear through their links. Point `aboutPostId`, `faqPostId` and
 * `contactPostId` in `server/settings/stage1Lw.ts` at the printed IDs.
 *
 * Dry run by default; pass `{ execute: true }` to write. Safe to re-run: a
 * page whose title already exists for the admin account is skipped.
 *
 * Usage: yarn repl prod lw packages/lesswrong/scripts/createSeedsPlaceholderPages.ts "createSeedsPlaceholderPages({ execute: true })"
 */

const PAGE_TITLES = ["About", "FAQ", "Contact"];

export async function createSeedsPlaceholderPages({ execute = false, adminUsername = "taylortest" }: {
  execute?: boolean,
  adminUsername?: string,
} = {}) {
  const admin = await Users.findOne({ username: adminUsername });
  if (!admin?.isAdmin) throw new Error(`${adminUsername} is not an admin account`);
  const context = await computeContextFromUser({ user: admin, isSSR: false });

  console.log(execute ? "EXECUTING" : "DRY RUN");
  for (const title of PAGE_TITLES) {
    const existing = await Posts.findOne({ title, userId: admin._id, deletedDraft: false });
    if (existing) {
      console.log(`${title}: already exists (${existing._id})`);
      continue;
    }
    if (!execute) {
      console.log(`${title}: would create`);
      continue;
    }
    const post = await createPost({
      data: {
        title,
        draft: false,
        unlisted: true,
        hideFromRecentDiscussions: true,
        submitToFrontpage: false,
        contents: {
          originalContents: {
            type: "markdown",
            data: title,
          },
        },
      },
    }, context);
    console.log(`${title}: created (${post._id})`);
  }
}

export default createSeedsPlaceholderPages;

import pgPromise from "pg-promise";
import { getSqlClientOrThrow } from "@/server/sql/sqlClient";
import { Tags } from "@/server/collections/tags/collection";
import { TagRels } from "@/server/collections/tagRels/collection";
import { Users } from "@/server/collections/users/collection";
import { createTag } from "@/server/collections/tags/mutations";
import { addOrUpvoteTag } from "@/server/tagging/tagsGraphQL";
import { computeContextFromUser } from "@/server/vulcan-lib/apollo-server/context";

/* eslint-disable no-console */

/**
 * Creates a tag for each public Second Renaissance Discourse category and tags
 * the migrated posts with their original category (issue #26). The Discourse
 * importer didn't carry categories over.
 *
 * Reads topic categories from the local `discourse_backup` database
 * (DISCOURSE_SOURCE_URL, localhost only). Dry run by default; pass
 * `{ execute: true }` to write. Safe to re-run: existing tags (by slug) and
 * existing tag-post links are skipped.
 *
 * Usage: yarn repl prod lw packages/lesswrong/scripts/createSecondRenaissanceCategoryTags.ts "createSecondRenaissanceCategoryTags({ execute: true })"
 */

interface CategoryTag {
  discourseCategoryId: number
  name: string
  slug: string
}

// The Staff category (#3) is private and its topics weren't migrated
const CATEGORY_TAGS: CategoryTag[] = [
  { discourseCategoryId: 4, name: "General", slug: "general" },
  { discourseCategoryId: 6, name: "Ideas", slug: "ideas" },
  { discourseCategoryId: 7, name: "People and Orgs", slug: "people-and-orgs" },
  { discourseCategoryId: 11, name: "Welcome", slug: "welcome" },
  { discourseCategoryId: 12, name: "Events", slug: "events" },
];

interface MigratedPost {
  _id: string
  title: string
  topicId: string
}

function getSourceUrl(): string {
  const raw = process.env.DISCOURSE_SOURCE_URL;
  if (!raw) throw new Error("DISCOURSE_SOURCE_URL is required");
  const url = new URL(raw);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/discourse_backup") {
    throw new Error("DISCOURSE_SOURCE_URL must point at the local discourse_backup database");
  }
  return raw;
}

async function getTopicCategories(): Promise<Map<string, number>> {
  const source = pgPromise()(getSourceUrl());
  try {
    const topics: { id: number, category_id: number }[] = await source.any(
      `SELECT id, category_id FROM topics WHERE category_id IS NOT NULL`
    );
    return new Map(topics.map(t => [String(t.id), t.category_id]));
  } finally {
    // Only close this connection; pgp.end() would also close the app's database pool
    await source.$pool.end();
  }
}

async function getMigratedPosts(): Promise<MigratedPost[]> {
  const db = getSqlClientOrThrow();
  return db.any(`
    -- createSecondRenaissanceCategoryTags.getMigratedPosts
    SELECT _id, title, "legacyData"->>'secondRenaissanceDiscourseTopicId' AS "topicId"
    FROM "Posts"
    WHERE "legacyData" ? 'secondRenaissanceDiscourseTopicId'
  `);
}

export async function createSecondRenaissanceCategoryTags({ execute = false, adminUsername = "taylortest" }: {
  execute?: boolean,
  adminUsername?: string,
} = {}) {
  const admin = await Users.findOne({ username: adminUsername });
  if (!admin?.isAdmin) throw new Error(`${adminUsername} is not an admin account`);
  const context = await computeContextFromUser({ user: admin, isSSR: false });

  const topicCategories = await getTopicCategories();
  const posts = await getMigratedPosts();
  console.log(`${execute ? "EXECUTING" : "DRY RUN"}: ${posts.length} migrated posts, ${CATEGORY_TAGS.length} categories`);

  for (const category of CATEGORY_TAGS) {
    const categoryPosts = posts.filter(p => topicCategories.get(p.topicId) === category.discourseCategoryId);
    let tag = await Tags.findOne({ slug: category.slug, deleted: false });

    if (!tag) {
      console.log(`Create tag "${category.name}" (${category.slug})`);
      if (execute) {
        await createTag({ data: { name: category.name, slug: category.slug } }, context);
        tag = await Tags.findOne({ slug: category.slug, deleted: false });
      }
    } else {
      console.log(`Tag "${category.name}" already exists (${tag._id})`);
    }

    for (const post of categoryPosts) {
      const alreadyTagged = tag && await TagRels.findOne({ tagId: tag._id, postId: post._id, deleted: false });
      if (alreadyTagged) continue;
      console.log(`  Tag "${post.title}" as ${category.name}`);
      if (execute && tag) {
        await addOrUpvoteTag({ tagId: tag._id, postId: post._id, currentUser: admin, context });
      }
    }
  }

  const uncategorized = posts.filter(p => !CATEGORY_TAGS.some(c => c.discourseCategoryId === topicCategories.get(p.topicId)));
  if (uncategorized.length) {
    console.log(`Posts with no matching category: ${uncategorized.map(p => p.title).join(", ")}`);
  }
}

export default createSecondRenaissanceCategoryTags;

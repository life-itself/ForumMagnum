import pgPromise from "pg-promise";
import { getSqlClientOrThrow } from "@/server/sql/sqlClient";
import { Tags } from "@/server/collections/tags/collection";
import { TagRels } from "@/server/collections/tagRels/collection";
import { Users } from "@/server/collections/users/collection";
import { createTag, updateTag } from "@/server/collections/tags/mutations";
import { addOrUpvoteTag } from "@/server/tagging/tagsGraphQL";
import { computeContextFromUser } from "@/server/vulcan-lib/apollo-server/context";
import { CATEGORY_TAGS } from "./secondRenaissanceMigrationChecks";
import { getSourceUrl } from "./secondRenaissanceDiscourseSource";

/* eslint-disable no-console */

/**
 * Creates a tag for each public Second Renaissance Discourse category and tags
 * the migrated posts with their original category (issue #26). The Discourse
 * importer didn't carry categories over.
 *
 * Reads topic categories from a local `discourse_backup*` database
 * (DISCOURSE_SOURCE_URL, localhost only). Dry run by default; pass
 * `{ execute: true }` to write. Safe to re-run: existing tags (by slug) and
 * existing tag-post links are skipped, and renamed categories rename their tag.
 * importSecondRenaissanceDiscourse runs this after each import.
 *
 * Usage: yarn repl prod lw packages/lesswrong/scripts/createSecondRenaissanceCategoryTags.ts "createSecondRenaissanceCategoryTags({ execute: true })"
 */

interface MigratedPost {
  _id: string
  title: string
  topicId: string
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
    let tag = await Tags.findOne({ slug: { $in: [category.slug, ...(category.previousSlugs ?? [])] }, deleted: false });

    if (!tag) {
      console.log(`Create tag "${category.name}" (${category.slug})`);
      if (execute) {
        await createTag({ data: { name: category.name, slug: category.slug } }, context);
        tag = await Tags.findOne({ slug: category.slug, deleted: false });
      }
    } else if (tag.name !== category.name) {
      // The Discourse category was renamed
      console.log(`Rename tag "${tag.name}" to "${category.name}"`);
      if (execute) await updateTag({ selector: { _id: tag._id }, data: { name: category.name } }, context);
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

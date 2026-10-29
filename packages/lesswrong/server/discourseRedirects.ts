import { combineUrls, getSiteUrl } from "@/lib/vulcan-lib/utils";
import { postGetAbsolutePageUrl } from "@/lib/collections/posts/helpers";
import { commentGetAbsolutePageUrlFromDB } from "@/lib/collections/comments/helpers";
import { createAnonymousContext } from "@/server/vulcan-lib/createContexts";
import { getSqlClientOrThrow } from "@/server/sql/sqlClient";
import { CATEGORY_TAGS } from "@/scripts/secondRenaissanceMigrationChecks";
import type { ForumTypeString } from "@/lib/instanceSettings";

/**
 * Where links to the old Second Renaissance Discourse forum should go (issue
 * #51). Migrated posts, comments and uploads keep their Discourse IDs and URLs
 * in `legacyData` and the Images table, so old links map to the matching page.
 * Anything unknown, or no longer public, goes to the home page.
 */

const DISCOURSE_ORIGIN = "https://forum.secondrenaissance.net";

const isNumeric = (segment: string | undefined) => !!segment && /^\d+$/.test(segment);

/**
 * A migrated post found by its old Discourse topic slug, for links without a
 * topic ID. Post slugs here are truncated versions of the same title slug, so
 * this picks the longest post slug the old one starts with.
 */
async function findPostByDiscourseSlug(discourseSlug: string): Promise<DbPost | null> {
  return getSqlClientOrThrow("read").oneOrNone(`
    -- discourseRedirects.postBySlug
    SELECT * FROM "Posts"
    WHERE "legacyData" ? 'secondRenaissanceDiscourseTopicId' AND NOT draft AND NOT "deletedDraft"
      AND LENGTH(slug) >= 10 AND $1 LIKE slug || '%'
    ORDER BY LENGTH(slug) DESC
    LIMIT 1
  `, [discourseSlug.toLowerCase()]);
}

/** /t/<slug>/<topicId>[/<postNumber>], /t/<topicId>[/<postNumber>] or /t/<slug> */
export async function getDiscourseTopicRedirect(segments: string[], forumType: ForumTypeString): Promise<string> {
  const [topicId, postNumber] = isNumeric(segments[0]) ? segments : segments.slice(1);
  if (!isNumeric(topicId)) {
    const post = segments[0] ? await findPostByDiscourseSlug(segments[0]) : null;
    return post ? postGetAbsolutePageUrl(post, forumType) : getSiteUrl(forumType);
  }
  const db = getSqlClientOrThrow("read");

  if (isNumeric(postNumber) && postNumber !== "1") {
    const comment: DbComment | null = await db.oneOrNone(`
      -- discourseRedirects.comment
      SELECT * FROM "Comments"
      WHERE "legacyData"->>'secondRenaissanceDiscourseTopicId' = $1
        AND ("legacyData"->>'secondRenaissanceDiscoursePostNumber')::int = $2
        AND NOT deleted
    `, [topicId, Number(postNumber)]);
    if (comment) return commentGetAbsolutePageUrlFromDB(comment, createAnonymousContext({ forumType }));
  }

  const post: DbPost | null = await db.oneOrNone(`
    -- discourseRedirects.post
    SELECT * FROM "Posts"
    WHERE "legacyData"->>'secondRenaissanceDiscourseTopicId' = $1 AND NOT draft AND NOT "deletedDraft"
  `, [topicId]);
  return post ? postGetAbsolutePageUrl(post, forumType) : getSiteUrl(forumType);
}

/** /c/<slug>/<categoryId>, /c/<parent>/<slug>/<categoryId> or /c/<slug> */
export function getDiscourseCategoryRedirect(segments: string[], forumType: ForumTypeString): string {
  const categoryId = segments.find(isNumeric);
  const category = CATEGORY_TAGS.find(c => categoryId
    ? c.discourseCategoryId === Number(categoryId)
    : segments.includes(c.slug) || c.previousSlugs?.some(s => segments.includes(s)));
  return category ? combineUrls(getSiteUrl(forumType), `/w/${category.slug}`) : getSiteUrl(forumType);
}

/** /uploads/... files, moved to Cloudinary by the importer */
export async function getDiscourseUploadRedirect(segments: string[], forumType: ForumTypeString): Promise<string> {
  const db = getSqlClientOrThrow("read");
  const image: { cdnHostedUrl: string } | null = await db.oneOrNone(`
    -- discourseRedirects.upload
    SELECT "cdnHostedUrl" FROM "Images" WHERE identifier = $1 LIMIT 1
  `, [`${DISCOURSE_ORIGIN}/uploads/${segments.join("/")}`]);
  return image?.cdnHostedUrl ?? getSiteUrl(forumType);
}

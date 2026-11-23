/* eslint-disable no-console */
import { getSqlClientOrThrow } from "@/server/sql/sqlClient";
import { Users } from "@/server/collections/users/collection";
import { updatePost } from "@/server/collections/posts/mutations";
import { updateComment } from "@/server/collections/comments/mutations";
import { computeContextFromUser } from "@/server/vulcan-lib/apollo-server/context";
import { loadDiscourseSource } from "./secondRenaissanceDiscourseSource";
import { addYoutubeEmbedsToHtml, getDiscourseYoutubeVideoIds } from "./secondRenaissanceDiscourseHtml";

/**
 * Embeds the YouTube videos that Discourse showed as playable videos, in
 * migrated posts and replies that imports before this fix turned into title
 * links only. Each change is a normal edit, so it gets a new revision and
 * search is updated. Videos already embedded (such as a post fixed by hand)
 * are left alone, so it is safe to re-run.
 *
 * Needs DISCOURSE_SOURCE_URL, like the importer. Dry run by default; pass
 * `{ execute: true }` to write.
 *
 * Usage: npm run repl -- prod lw packages/lesswrong/scripts/embedSecondRenaissanceYoutubeVideos.ts "embedSecondRenaissanceYoutubeVideos({ execute: true })"
 */

interface MigratedContent {
  collectionName: "Posts" | "Comments"
  _id: string
  discoursePostId: string
  originalContents: { type: string, data: string }
}

async function loadMigratedContent(discoursePostIds: string[]): Promise<MigratedContent[]> {
  const db = getSqlClientOrThrow("read");
  return db.any(`
    -- embedSecondRenaissanceYoutubeVideos
    SELECT 'Posts' AS "collectionName", p._id,
      p."legacyData"->>'secondRenaissanceDiscourseOpeningPostId' AS "discoursePostId", r."originalContents"
    FROM "Posts" p JOIN "Revisions" r ON r._id = p.contents_latest
    WHERE p."legacyData"->>'secondRenaissanceDiscourseOpeningPostId' IN ($(discoursePostIds:csv))
    UNION ALL
    SELECT 'Comments', c._id, c."legacyData"->>'secondRenaissanceDiscoursePostId', r."originalContents"
    FROM "Comments" c JOIN "Revisions" r ON r._id = c.contents_latest
    WHERE c."legacyData"->>'secondRenaissanceDiscoursePostId' IN ($(discoursePostIds:csv))
  `, { discoursePostIds });
}

export async function embedSecondRenaissanceYoutubeVideos({ execute = false, adminUsername = "taylortest" }: {
  execute?: boolean,
  adminUsername?: string,
} = {}) {
  const admin = await Users.findOne({ username: adminUsername });
  if (!admin?.isAdmin) throw new Error(`${adminUsername} is not an admin account`);
  const context = await computeContextFromUser({ user: admin, isSSR: false });
  console.log(execute ? "EXECUTING" : "DRY RUN");

  const source = await loadDiscourseSource();
  const videoIdsByDiscoursePostId = new Map(source.posts
    .map(post => [String(post.id), getDiscourseYoutubeVideoIds(post.cooked)] as const)
    .filter(([, videoIds]) => videoIds.length));

  const counts = { updated: 0, alreadyEmbedded: 0, notCkEditor: 0 };
  for (const content of await loadMigratedContent([...videoIdsByDiscoursePostId.keys()])) {
    const { collectionName, _id, discoursePostId, originalContents } = content;
    if (originalContents.type !== "ckEditorMarkup") {
      console.log(`${collectionName} ${_id}: edited in ${originalContents.type} since the import, fix by hand`);
      counts.notCkEditor++;
      continue;
    }
    const data = addYoutubeEmbedsToHtml(originalContents.data, videoIdsByDiscoursePostId.get(discoursePostId)!);
    if (data === originalContents.data) {
      counts.alreadyEmbedded++;
      continue;
    }
    counts.updated++;
    if (!execute) {
      console.log(`${collectionName} ${_id}: would add embeds`);
      continue;
    }
    const contents = { originalContents: { type: "ckEditorMarkup", data } };
    if (collectionName === "Posts") {
      await updatePost({ selector: { _id }, data: { contents } }, context);
    } else {
      await updateComment({ selector: { _id }, data: { contents } }, context);
    }
    console.log(`${collectionName} ${_id}: embeds added`);
  }
  console.log(`${execute ? "Updated" : "Would update"} ${counts.updated}; already embedded ${counts.alreadyEmbedded}; not ckEditor ${counts.notCkEditor}`);
}

export default embedSecondRenaissanceYoutubeVideos;

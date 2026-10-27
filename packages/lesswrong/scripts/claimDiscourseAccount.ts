import { getSqlClientOrThrow } from "@/server/sql/sqlClient";
import { mergeAccounts } from "@/server/scripts/mergeAccounts";

/* eslint-disable no-console */

/**
 * Links an old Discourse member's history to the account they already have on
 * the forum (issue #50). Moves everything from their imported account onto
 * that account with the admin "merge accounts" tool, then moves the Discourse
 * link, so later runs of importSecondRenaissanceDiscourse treat the member's
 * own account as theirs and leave its name, username and email alone. The
 * imported account is marked deleted.
 *
 * Dry run by default; pass `execute: true` to merge. Run
 * verifySecondRenaissanceMigration afterwards.
 *
 * Usage: yarn repl prod lw packages/lesswrong/scripts/claimDiscourseAccount.ts "claimDiscourseAccount({ discourseUsername: 'RobertBunge', forumUsername: 'robert_bunge', execute: true })"
 */

interface AccountRow {
  _id: string
  username: string
  displayName: string
  legacyData: Record<string, unknown> | null
}

export async function claimDiscourseAccount({ discourseUsername, forumUsername, execute = false }: {
  discourseUsername: string,
  /** Username or profile slug of the account the member uses now */
  forumUsername: string,
  execute?: boolean,
}): Promise<void> {
  const db = getSqlClientOrThrow();
  const imported: AccountRow | null = await db.oneOrNone(`
    -- claimDiscourseAccount imported
    SELECT _id, username, "displayName", "legacyData" FROM "Users"
    WHERE LOWER("legacyData"->>'secondRenaissanceDiscourseUsername') = LOWER($1)
  `, [discourseUsername]);
  if (!imported) throw new Error(`No account is linked to Discourse user ${discourseUsername}`);
  if (imported.legacyData?.secondRenaissanceDiscourseClaimed) {
    console.log(`Discourse user ${discourseUsername} is already linked to ${imported.username}`);
    return;
  }
  const target: AccountRow | null = await db.oneOrNone(`
    -- claimDiscourseAccount target
    SELECT _id, username, "displayName", "legacyData" FROM "Users"
    WHERE (username = $1 OR slug = $1) AND NOT deleted
  `, [forumUsername]);
  if (!target) throw new Error(`No forum account with username or slug ${forumUsername}`);
  if (target.legacyData && "secondRenaissanceDiscourseUserId" in target.legacyData) {
    throw new Error(`${forumUsername} is already linked to a Discourse user`);
  }

  console.log(`${execute ? "EXECUTING" : "DRY RUN"}: move "${imported.displayName}" (${imported._id}) into account ${target._id}`);
  // The merge edits comments through the normal permission checks, which
  // refuse comments the importer deleted (no longer public in Discourse).
  // They're hidden either way, so move them directly first.
  const hiddenComments = await db.one(`
    SELECT COUNT(*)::int AS count FROM "Comments" WHERE "userId" = $1 AND deleted
  `, [imported._id]);
  console.log(`${hiddenComments.count} deleted comment(s) to move directly`);
  if (execute && hiddenComments.count) {
    await db.tx(async tx => {
      await tx.none(`
        UPDATE "Revisions" SET "userId" = $(targetId)
        WHERE "userId" = $(importedId) AND "collectionName" = 'Comments'
          AND "documentId" IN (SELECT _id FROM "Comments" WHERE "userId" = $(importedId) AND deleted)
      `, { targetId: target._id, importedId: imported._id });
      await tx.none(`
        UPDATE "Comments" SET "userId" = $(targetId) WHERE "userId" = $(importedId) AND deleted
      `, { targetId: target._id, importedId: imported._id });
    });
  }

  const result = await mergeAccounts({ sourceUserId: imported._id, targetUserId: target._id, dryRun: !execute });
  if (!result.success) {
    console.log("Merge failures:", result.failures);
    throw new Error("Merge failed; the Discourse link was not moved. Re-running resumes the merge.");
  }
  if (!execute) return;

  const discourseUserId = imported.legacyData?.secondRenaissanceDiscourseUserId;
  await db.tx(async tx => {
    await tx.none(`
      UPDATE "Users" SET "legacyData" = COALESCE("legacyData", '{}'::jsonb) || $(link)::jsonb WHERE _id = $(targetId)
    `, {
      targetId: target._id,
      link: JSON.stringify({
        secondRenaissanceDiscourseUserId: discourseUserId,
        secondRenaissanceDiscourseUsername: imported.legacyData?.secondRenaissanceDiscourseUsername,
        secondRenaissanceDiscourseClaimed: true,
      }),
    });
    // The deleted imported account gives up the member's Discourse username
    await tx.none(`
      UPDATE "Users" SET username = 'discourse_merged_' || $(discourseUserId),
        "legacyData" = ("legacyData" - 'secondRenaissanceDiscourseUserId')
          || jsonb_build_object('secondRenaissanceDiscourseMergedInto', $(targetId), 'secondRenaissanceDiscourseFormerUserId', $(discourseUserId))
      WHERE _id = $(importedId)
    `, { targetId: target._id, importedId: imported._id, discourseUserId });
  });
  console.log(`Linked Discourse user ${discourseUsername} to ${target._id}`);

  // Signing up with Google can leave an email address as the username
  const discourseName = String(imported.legacyData?.secondRenaissanceDiscourseUsername ?? "");
  if (/\S+@\S+\.\S+/.test(target.username) && discourseName) {
    const renamed = await db.result(`
      UPDATE "Users" SET username = $(username)
      WHERE _id = $(targetId) AND NOT EXISTS (
        SELECT 1 FROM "Users" WHERE LOWER(username) = LOWER($(username)) AND _id <> $(targetId)
      )
    `, { username: discourseName, targetId: target._id });
    console.log(renamed.rowCount
      ? `Replaced the email-address username with "${discourseName}"`
      : `The username is an email address, but "${discourseName}" is taken; change it by hand`);
  }
}

export default claimDiscourseAccount;

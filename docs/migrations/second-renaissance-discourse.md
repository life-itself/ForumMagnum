# Second Renaissance Discourse Migration

Related issue: https://github.com/life-itself/ForumMagnum/issues/14

## Overview

Migrated the eligible public content from the Second Renaissance
Discourse forum into ForumMagnum, hosted on Railway.

The migration used a PostgreSQL Discourse backup rather than
scraping the original website.

## Pilot

A representative sample of three discussions (Discourse topic IDs
49, 71, and 78) was imported and tested before the full migration.

Testing covered:
- Post content and HTML formatting
- Historical authorship and publication dates
- Comments and nested replies
- Revision records
- Links and images

## Production migration

Completed October 19, 2026.

Imported:
- 30 historical accounts, including the Discourse system account
- 38 public discussions
- 58 comments
- 96 content revisions

The Railway database contained 7 users, 12 posts, and 31 comments
before migration.

Verified totals afterward:
- 37 users
- 50 posts
- 89 comments

The production import completed successfully in a single database
transaction. Existing ForumMagnum content was preserved.

## Exclusions

The migration intentionally excluded:
- 40 private-message topics
- 3 Staff-only discussions (Discourse topic IDs 2, 4, and 6)
- Deleted or otherwise ineligible content

These exclusions prevent restricted content from becoming public.

## Implementation

Production importer:
`scripts/importSecondRenaissanceProduction.ts`

The importer uses a local Discourse PostgreSQL database as its
source and Railway PostgreSQL as its destination.

It includes:
- A read-only preflight mode
- Production target verification
- Existing-data checks
- Duplicate-import safeguards
- Explicit execution confirmation
- Transactional insertion and verification

The production importer was tested against a restored copy of the
Railway database before execution.

Database credentials and Discourse backups are not included in
this repository.

Do not rerun the production importer against an already-migrated
database. Review the safeguards and take a fresh backup before
attempting any additional migration operations.

## Verification

The production importer verified the imported record counts and
confirmed rendered HTML for all 58 comments.

The migrated discussions were also inspected on the live
ForumMagnum website and confirmed viewable.

## Known limitations and follow-up work

### External images and attachments

Some migrated content continues to reference images hosted on
the original Discourse server.

These images were observed displaying, but availability depends
on the original hosting remaining accessible. Asset transfer
should be addressed before retiring the original forum.

### Legacy internal links

The opening post of "First Steps for New Members" (Discourse topic
5, opening post 6) contains two links to the original Discourse
forum:

- https://forum.secondrenaissance.net/t/resources-for-new-members/47
- https://forum.secondrenaissance.net/t/about-the-ideas-category/15

Both corresponding discussions exist on the new ForumMagnum
deployment. The links were left unchanged to avoid modifying the
imported content and its editor revision state directly.

## Outcome

The representative pilot and the full public-content migration
were completed successfully. Known link and media dependencies
are documented for follow-up maintenance.

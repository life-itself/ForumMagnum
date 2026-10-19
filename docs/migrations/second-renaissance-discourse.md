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

Verified totaVerified totaVerified ts
-----------------------------------------------------------ucce---------------------------------------n. -----------------------------------------------------------ucce---gra----------tio-----------------------------------------------------------ucscus--------------------------------------------------or o-----------------------------------------------------------ic-----------------becoming public-------mpl-----------------------------------------------------------ucceceProduction.ts`

The importer uses a local Discourse PostgreSQL databaThe importer use The importer uses a local DiscourtiThe importer uses a local Discourse PostgreSt The importer uses a local Diification
- Existing-data checks
- Duplic- Duplic- Dupliguards
- E- E- E- E- E- E- E- E-irmation
- Transa- Transa- Transa- Transa- Transa- Transa- Transa- Transa- Trwas tested against a restored copy of the
Railway database before eRailway database before eRailway database before eRailway databncluded in
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

Some migrated content continues to reSome migrated content continues to reSome migrated content continues to reSome migrated content continues to reSome migrated content continues to reSome migrated content continues to reSod be addressed before retSome migrated content um.

###################################in###################################in###################################in##################################al###################################in###################################in############7
- https://f- https://f- naiss- https://f- https://f- naiss- https://f- https://f- naiss- htcus- https://f- https://f- naiss- https://f- https://f- nai were l- https://f- https://f- naiss- https://ported con- https://fs edit- https://f- https://f- naiss- https://f- https://f- naiss- htlo- https://f- https://f- naiss- igration
were completed successfully. Known link and media dependencies
are documented for follow-up maintenance.

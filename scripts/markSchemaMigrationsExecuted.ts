import { initGlobals } from "./scriptUtil";
import { initConsole } from "../packages/lesswrong/server/serverStartup";
import { getSqlClientOrThrow } from "../packages/lesswrong/server/sql/sqlClient";
import { skipMigrationsAfterDatabaseInit } from "../packages/lesswrong/server/migrations/meta/umzug";

async function main() {
  if (!process.env.PG_URL) {
    throw new Error("PG_URL is required");
  }

  initGlobals(false);
  initConsole();

  await skipMigrationsAfterDatabaseInit();
  await getSqlClientOrThrow().$pool.end();
}

void main();

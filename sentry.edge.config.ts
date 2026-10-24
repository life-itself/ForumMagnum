// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import { getSentry } from "@/lib/sentryWrapper";

const Sentry = getSentry();

// NEXT_PUBLIC_SENTRY_DSN lets a deployment report to its own Sentry project;
// unset keeps the upstream DSN, and "" or "none" disables Sentry.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "https://1ab1949fc8d04608b43132f37bb2a1b0@o195791.ingest.us.sentry.io/1301611";
const sentryEnabled = !!dsn && dsn !== "none";

Sentry?.init({
  dsn: sentryEnabled ? dsn : undefined,
  environment: process.env.NODE_ENV ?? "development",
  integrations: [
    Sentry.dedupeIntegration(),
    Sentry.extraErrorDataIntegration(),
  ],

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  enabled: sentryEnabled,
});

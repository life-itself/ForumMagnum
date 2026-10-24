// @ts-check
// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/


const { getSentry } = require('@/lib/sentryWrapper');

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

  beforeSend: (event, hint) => {
    // Suppress an uninformative error from ReCaptcha
    // See: https://github.com/getsentry/sentry-javascript/issues/2514
    if (hint?.originalException === "Timeout") {
      return null;
    }

    return event;
  },

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  enabled: sentryEnabled,
});

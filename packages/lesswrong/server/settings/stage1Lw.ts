import merge from "lodash/merge";
import { sharedSettings } from "./sharedSettings";

const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";
// Seeds of Renaissance brand assets, from https://design.seedsofrenaissance.org/system/logo/
const brandAssetsPath = "/brand/seeds-of-renaissance";

const stage1LwSettings = merge({
  forumType: "LessWrong",
  title: "Seeds of Renaissance",
  tagline: "Vision and movement for civilisational rebirth",
  siteNameWithArticle: "Seeds of Renaissance",
  siteUrl,
  brandTheme: "seedsOfRenaissance",
  sentry: {
    url: null,
    environment: "stage1",
    release: null,
  },
  // Placeholder posts (unlisted), created by scripts/createSeedsPlaceholderPages.ts
  aboutPostId: "reavZJCFXrh6tL7HD",
  faqPostId: "3Qe8vaaKY6TRviapr",
  contactPostId: "GPg4NcPdLJgBLSrNd",
  faviconUrl: `${brandAssetsPath}/favicon.ico`,
  // The design system has no badged favicon variant
  faviconWithBadge: `${brandAssetsPath}/favicon.ico`,
  forumSettings: {
    headerTitle: "Seeds of Renaissance",
    shortForumTitle: "Seeds",
    tabTitle: "Seeds of Renaissance",
    headerLogoUrl: `${brandAssetsPath}/seeds-mark-colour-64.png`,
    headerLogoDarkUrl: `${brandAssetsPath}/seeds-mark-colour-dark-64.png`,
    // The Seeds seed spiral replaces LessWrong's art and seasonal banners
    backgroundImageUrl: `${brandAssetsPath}/seed-spiral.svg`,
    backgroundImageDarkUrl: `${brandAssetsPath}/seed-spiral-dark.svg`,
    // The poke invites users to LessWrong meetups
    showMeetupsPoke: false,
    // In place of LessWrong's comment guidelines under the comment box
    commentGuidelinesHtml: `<p><em>Comment guidelines:</em> please keep to our <a href="/faq">ground rules</a>. Respect each other, stay on topic, and avoid personal attacks.</p>`,
    // The default daily view starts at today, which is empty for the migrated posts
    allPostsDefaultTimeframe: "allTime",
    hiddenMenuTabs: [
      "library",
      "bestoflesswrong",
      "highlights",
      "r-az",
      "codex",
      "hpmor",
      "lwAlbum",
      "leaderboard",
      // The Community section is built around LessWrong's meetup groups
      "events",
      "eventsList",
    ],
  },
  // The migrated Discourse posts are older than the default 90-day cutoff, which
  // left the home page feed empty
  frontpageAlgorithm: {
    daysAgoCutoff: 3650,
  },
  analytics: {
    environment: "stage1",
  },
  testServer: process.env.TEST_SERVER !== "false",
  debug: false,
  // No crossposting to the EA Forum
  fmCrosspost: { siteName: null, baseUrl: null },
  allowTypeIIIPlayer: false,
  hasRejectedContentSection: true,
  hasCuratedPosts: true,
  expectedDatabaseId: "development",
  performanceMetricLogging: {
    enabled: false,
  },
  recombee: {
    enabled: false,
    databaseId: null,
    publicApiToken: null,
  },
  homepagePosts: {
    feeds: [
      {
        name: "forum-classic",
        label: "Recent",
        description: "Recent posts ordered with the classic frontpage algorithm.",
        showToLoggedOut: true,
      },
      {
        name: "forum-archive",
        label: "Recommended",
        description: "A random pick of well-liked posts you haven't read yet.",
        showToLoggedOut: true,
      },
      {
        name: "forum-top",
        label: "Most popular",
        description: "The highest-scoring posts of all time.",
        showToLoggedOut: true,
      },
      {
        name: "forum-bookmarks",
        label: "Bookmarks",
        description: "A list of posts you saved because you wanted to have them findable later.",
      },
    ],
  },
  annualReview: {
    showReviewOnFrontPageIfActive: false,
    announcementPostPath: null,
    votingResultsPostPath: "",
  },
  lightconeFundraiser: {
    active: false,
    postId: "",
    paymentLinkId: "",
    thermometerGoalAmount: 0,
    thermometerGoal2Amount: 0,
    thermometerGoal3Amount: 0,
    thermometerBgUrl: "",
  },
  ultraFeedEnabled: false,
}, sharedSettings);

// sharedSettings wins the merge above, so keys it also sets (LessWrong's logo,
// social image, Intercom app and Cloudinary presets) must be overridden afterwards.
const mergedSettings = merge(stage1LwSettings, {
  // Sends automated moderation messages. The email is only used if the account
  // has to be created, and this setting is public.
  adminAccount: {
    _id: "CLZ2dgmWwYbBgAqMY",
    username: "taylortest",
    email: "support@nextwavedev.org",
  },
  moderationEmail: "support@nextwavedev.org",
  logoUrl:`${siteUrl}${brandAssetsPath}/seeds-mark-colour-512.png`,
  siteImage: `${siteUrl}${brandAssetsPath}/seeds-mark-colour-512.png`,
  intercomAppId: "",
  // Unsigned upload presets in the Seeds Cloudinary account, whose cloud name is
  // set by the NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME env var
  cloudinary: {
    uploadPresetEditor: "seeds_editor",
    uploadPresetBanner: "seeds_banner",
    uploadPresetGridImage: "seeds_grid_image",
    uploadPresetSocialPreview: "seeds_social_preview",
    uploadPresetProfile: "seeds_profile",
    uploadPresetSpotlight: null,
  },
  // LessWrong's default banner is an image in LessWrong's Cloudinary account
  defaultSequenceBannerId: null,
  // Turn off LessWrong's third-party accounts. Sentry, Google Tag Manager,
  // reCaptcha and Google Maps are configured with NEXT_PUBLIC_* env vars instead
  // (see instanceSettings.ts and the sentry.*.config files).
  mapbox: { apiKey: null },
  stripe: { publicKey: null },
  logRocket: { apiKey: null },
  ckEditor: { uploadUrl: null, webSocketUrl: null },
  recombee: { enabled: false },
  petrov: { petrovServerUrl: null },
});

// merge() can't empty a list or map that sharedSettings sets, so these replace
// LessWrong's values outright.
export const stage1Lw = Object.assign(mergedSettings, {
  // LessWrong user IDs with access to the paid AI chat; admins still see it
  llmChat: { userIds: [] },
  // LessWrong's tag IDs for the default home feed filters
  defaultVisibilityTags: [],
  // LessWrong's hidden joke text replacements
  textReplacements: {},
});

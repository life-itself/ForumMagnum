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
  aboutPostId: "bJ2haLkcGeLtTWaD5",
  faqPostId: "2rWKkWuPrgTMpLRbp",
  contactPostId: "ehcYkvyz7dh9L7Wt8",
  faviconUrl: `${brandAssetsPath}/favicon.ico`,
  // The design system has no badged favicon variant
  faviconWithBadge: `${brandAssetsPath}/favicon.ico`,
  forumSettings: {
    headerTitle: "Seeds of Renaissance",
    shortForumTitle: "Seeds",
    tabTitle: "Seeds of Renaissance",
    headerLogoUrl: `${brandAssetsPath}/seeds-mark-colour-64.png`,
    headerLogoDarkUrl: `${brandAssetsPath}/seeds-mark-colour-dark-64.png`,
    showLWBackgroundImage: false,
    hiddenMenuTabs: [
      "library",
      "bestoflesswrong",
      "highlights",
      "r-az",
      "codex",
      "hpmor",
      "lwAlbum",
      "leaderboard",
    ],
  },
  analytics: {
    environment: "stage1",
  },
  testServer: process.env.TEST_SERVER !== "false",
  debug: false,
  fmCrosspost: { siteName: "the EA Forum", baseUrl: "https://forum.effectivealtruism.org/" },
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
export const stage1Lw = merge(stage1LwSettings, {
  logoUrl: `${siteUrl}${brandAssetsPath}/seeds-mark-colour-512.png`,
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

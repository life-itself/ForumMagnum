import merge from "lodash/merge";
import { sharedSettings } from "./sharedSettings";

export const stage1Lw = merge({
  forumType: "LessWrong",
  title: "ForumMagnum Stage 1",
  tagline: "Stage 1 self-hosted deployment",
  siteNameWithArticle: "ForumMagnum",
  siteUrl: "http://localhost:3000",
  sentry: {
    url: null,
    environment: "stage1",
    release: null,
  },
  aboutPostId: "bJ2haLkcGeLtTWaD5",
  faqPostId: "2rWKkWuPrgTMpLRbp",
  contactPostId: "ehcYkvyz7dh9L7Wt8",
  faviconUrl: "https://res.cloudinary.com/lesswrong-2-0/image/upload/v1497915096/favicon_lncumn.ico",
  faviconWithBadge: "https://res.cloudinary.com/lesswrong-2-0/image/upload/v1497915096/favicon_with_badge.ico",
  forumSettings: {
    headerTitle: "FORUMMAGNUM",
    shortForumTitle: "FM",
    tabTitle: "ForumMagnum Stage 1",
  },
  analytics: {
    environment: "stage1",
  },
  testServer: true,
  debug: false,
  disableElastic: true,
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

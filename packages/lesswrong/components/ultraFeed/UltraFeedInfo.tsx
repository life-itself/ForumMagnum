import React from 'react';
import { defineStyles, useStyles } from '../hooks/useStyles';
import { Link } from '../../lib/reactRouterWrapper';
import ContentStyles from '../common/ContentStyles';
import { useForumType } from '../hooks/useForumType';
import { brandThemeSetting, recombeeEnabledSetting, siteNameWithArticleSetting } from '@/lib/instanceSettings';

const styles = defineStyles("UltraFeedInfo", (theme: ThemeType) => ({
  settingGroup: {
    backgroundColor: theme.palette.background.paper,
    width: '100%',
    padding: 16,
    border: `1px solid ${theme.palette.grey[300]}`,
    borderRadius: 4,
    paddingLeft: 32,
    paddingRight: 32,
    paddingTop: 24,
    paddingBottom: 24,
    [theme.breakpoints.down('sm')]: {
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 16,
      paddingBottom: 16,
    },
  },
  paragraph: {
    marginBottom: 12,
    color: theme.palette.text.primary,
    fontSize: '1.1rem',
    lineHeight: 1.6,
  },
}));

const UltraFeedInfo = () => {
  const classes = useStyles(styles);
  const { forumType } = useForumType();
  const siteName = siteNameWithArticleSetting.get(forumType);
  // LessWrong's annual review and announcement post don't exist on deployments with their own brand
  const hasOwnBrand = !!brandThemeSetting.get(forumType);

  return (
    <ContentStyles contentType="ultraFeed">
      <div className={classes.settingGroup}>
        <p className={classes.paragraph}>
          The <strong>For You</strong> feed is an attempt to present you with the content you would most like to see from across all of {siteName}. The content is personalized based on your viewing/voting/etc history and by default includes:
        </p>
        <ul>
          <li>Recent posts and comments</li>
          <li>Recent content from users you've followed/subscribed to</li>
          {recombeeEnabledSetting.get(forumType) && <li>Recommended from {siteName}'s full archive of posts</li>}
          {!hasOwnBrand && <li>Feature content such as Annual Review winners</li>}
          <li>Your bookmarks</li>
          <li>Quick takes</li>
        </ul>
        <p className={classes.paragraph}>
          You can adjust the proportion of the content from each source in the settings.
          Note that within the feed, each comment is always a direct reply to the one above it.
          {!hasOwnBrand && <> Read more in the <Link to="/posts/AJuZj4Zv9iyHHRFwX/lesswrong-feed-new-now-in-beta">announcement post!</Link></>}
        </p>
        </div>
    </ContentStyles>
  );
};

export default UltraFeedInfo;

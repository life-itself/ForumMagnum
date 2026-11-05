import React from "react";
import { defineStyles, useStyles } from "../hooks/useStyles";
import { Link } from "../../lib/reactRouterWrapper";
import CommentsNewForm from "../comments/CommentsNewForm";
import { commentGetPageUrlFromIds } from "@/lib/collections/comments/helpers";
import { postGetCommentsUrl } from "@/lib/collections/posts/helpers";
import { useForumType } from "../hooks/useForumType";
import { brandThemeSetting } from "@/lib/instanceSettings";

const styles = defineStyles("UltraFeedReplyEditor", (theme: ThemeType) => ({
  replyEditorContainer: {
    marginBottom: 12,
    paddingRight: 16,
    background: theme.palette.grey[100],
    borderRadius: theme.borderRadius.small,
    [theme.breakpoints.down('sm')]: {
      paddingRight: 0,
    },
  },
  cannotReplyMessage: {
    padding: 16,
    marginTop: 8,
    marginBottom: 8,
    background: theme.palette.grey[100],
    borderRadius: theme.borderRadius.small,
    color: theme.palette.text.dim,
    fontSize: 14,
    fontFamily: theme.palette.fonts.sansSerifStack,
    fontStyle: 'italic',
  },
  viewAllCommentsButton: {
    cursor: 'pointer',
    color: theme.palette.primary.main,
    fontFamily: theme.palette.fonts.sansSerifStack,
    fontSize: 14,
    marginBottom: 8,
    '&:hover': {
      color: theme.palette.text.primary,
      opacity: 0.3,
    },
    [theme.breakpoints.down('sm')]: {
      fontSize: 17,
      paddingTop: 4,
      paddingBottom: 4,
    },
  },
}));

interface UltraFeedReplyEditorBaseProps {
  cannotReplyReason?: string | null;
  onReplySubmit: (newComment: UltraFeedComment) => void;
  onReplyCancel: () => void;
}

type UltraFeedReplyEditorPostProps = UltraFeedReplyEditorBaseProps & {
  document: PostsListWithVotes;
  collectionName: "Posts";
};

type UltraFeedReplyEditorCommentProps = UltraFeedReplyEditorBaseProps & {
  document: UltraFeedComment;
  collectionName: "Comments";
};

export type UltraFeedReplyEditorProps =
  | UltraFeedReplyEditorPostProps
  | UltraFeedReplyEditorCommentProps;

const UltraFeedReplyEditor = ({
  document,
  collectionName,
  cannotReplyReason,
  onReplySubmit,
  onReplyCancel,
}: UltraFeedReplyEditorProps) => {
  const classes = useStyles(styles);
  const { forumType } = useForumType();
  // lesswrong.com/editor is LessWrong's own guide; other brands get the editor's default hint
  const hintText = brandThemeSetting.get(forumType) ? undefined : "Text goes here! Visit lesswrong.com/editor for more info about the editor...";

  const post = collectionName === "Comments" ? document.post : document;

  if (!post) {
    return null;
  }

  const parentComment = collectionName === "Comments" ? document : undefined;
  
  const viewAllCommentsUrl = collectionName === "Comments" 
    ? commentGetPageUrlFromIds({
        postId: post._id,
        postSlug: post.slug,
        commentId: document._id,
      })
    : postGetCommentsUrl(post);

  return (
    <>
      {cannotReplyReason ? (
        <div className={classes.cannotReplyMessage}>
          {cannotReplyReason}
        </div>
      ) : (
        <div className={classes.replyEditorContainer}>
          <CommentsNewForm
            post={post}
            parentComment={parentComment}
            hideAlignmentForumCheckbox={true}
            successCallback={(newComment) => {
              if (!newComment || !post) {
                return;
              }
              
              onReplySubmit({
                ...newComment,
                post: post,
              });
            }}
            cancelCallback={onReplyCancel}
            interactionType={collectionName === "Comments" ? "reply" : "comment"}
            enableGuidelines={false}
            formStyle="default"
            overrideHintText={hintText}
          />
        </div>
      )}
      {viewAllCommentsUrl && (
        <Link to={viewAllCommentsUrl} className={classes.viewAllCommentsButton}>
          Click to view all comments
        </Link>
      )}
    </>
  );
};

export default UltraFeedReplyEditor; 

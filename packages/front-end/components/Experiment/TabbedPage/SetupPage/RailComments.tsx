import { useState } from "react";
import { Box } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { DiscussionInterface } from "shared/types/discussion";
import DiscussionThread from "@/components/DiscussionThread";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Text from "@/ui/Text";
import PlainCommentBox from "@/components/Comments/PlainCommentBox";
import RailDivider from "./RailDivider";

// The rail's Comments tab: a plain composer at the top, then the existing
// thread (set in review). The composer replaces
// DiscussionThread's own (CommentForm: write/preview tabs, image uploads, a
// footer) with PlainCommentBox: a text area with Discard and Comment inside
// it.
//
// It posts to the same endpoint as CommentForm and refreshes the same
// request, so the new comment appears in the thread below straight away
// (both share one cache entry for /discussion/experiment/:id).
export default function RailComments({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const { apiCall } = useAuth();
  const permissions = usePermissionsUtil();
  const projects = experiment.project ? [experiment.project] : [];
  const canComment =
    !experiment.archived && permissions.canAddComment(projects);

  const { data, mutate } = useApi<{ discussion: DiscussionInterface }>(
    `/discussion/experiment/${experiment.id}`,
  );

  const [comment, setComment] = useState("");

  return (
    <Box>
      {/* The composer first, then the thread (set in review). Not sticky:
        at the top of the tab it's already in view. */}
      {canComment ? (
        // Sticky at the top of the rail's own scroll area while the thread
        // scrolls under it (set in review). The page background keeps the
        // thread from showing through, and the divider comes along as the
        // section's bottom edge.
        <Box
          style={{
            position: "sticky",
            top: 0,
            zIndex: 5,
            backgroundColor: "var(--color-background)",
          }}
        >
          <PlainCommentBox
            value={comment}
            onChange={setComment}
            cta="Comment"
            onDiscard={() => setComment("")}
            onSubmit={async () => {
              await apiCall(`/discussion/experiment/${experiment.id}`, {
                method: "POST",
                body: JSON.stringify({ comment }),
              });
              setComment("");
              await mutate();
            }}
          />
          {/* The Details tab's soft divider, 20px either side (set in
            review). Off the space scale (16 → 24), so a raw value. */}
          <RailDivider my="20px" />
        </Box>
      ) : null}
      {/* Our own empty line once loaded with no comments (set in review):
        12px, not italic, and not DiscussionThread's "No comments." wording.
        Otherwise the thread, which also handles loading and errors. */}
      {data && !(data.discussion?.comments ?? []).length ? (
        // A block, not an inline span, so it lines up with the other tabs'
        // text. --slate-10, the same as the To Do items' secondary line; off
        // the text tokens, so set on the wrapper and inherited.
        <Box style={{ color: "var(--slate-10)" }}>
          <Text as="div" size="sm">
            No comments yet
          </Text>
        </Box>
      ) : (
        <DiscussionThread
          type="experiment"
          id={experiment.id}
          projects={projects}
          // The composer is above, not the thread's own.
          allowNewComments={false}
          // A small avatar, email on hover, abbreviated times, and wrapping so
          // nothing runs past the rail (set in review).
          compact
        />
      )}
    </Box>
  );
}

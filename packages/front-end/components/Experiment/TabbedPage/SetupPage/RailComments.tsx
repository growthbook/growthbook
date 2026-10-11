import { PiChatsCircle } from "react-icons/pi";
import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
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
    // A column filling the tab, so the empty state can take the rest.
    <Flex direction="column" style={{ flex: 1 }}>
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
            // Focused, the hover's outline and no violet ring (set in
            // review).
            focusAsHover
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
      {/* Our own empty state once loaded with no comments (set in review):
        centred in the space under the composer, with an icon, a short
        title and a nudge to start, in place of DiscussionThread's "No
        comments." Otherwise the thread, which also handles loading and
        errors. */}
      {data && !(data.discussion?.comments ?? []).length ? (
        <Flex
          direction="column"
          align="center"
          justify="center"
          gap="2"
          py="6"
          style={{
            flex: 1,
            textAlign: "center",
            // Centred between the composer's divider and the panel's
            // bottom edge (set in review): the area reaches up over the
            // divider's 20px margin and down over the panel's 16px bottom
            // padding, so neither offsets it. Only without a composer is
            // there no divider above to reach to.
            ...(canComment ? { marginTop: -20 } : {}),
            marginBottom: -16,
            // 24px above centre (set in review; tried 16px): the icon on
            // top makes the group look low when centred exactly. A
            // transform, so nothing else moves.
            transform: "translateY(-24px)",
          }}
        >
          {/* 24px in --slate-10, as the experiments list's empty state's
            icon (about 3.8:1, above the 3:1 asked of icons). */}
          <PiChatsCircle
            size={24}
            aria-hidden
            style={{ color: "var(--slate-10)" }}
          />
          <Box style={{ color: "var(--slate-12)" }}>
            <Text as="div" align="center" size="md" weight="medium">
              It&apos;s quiet in here
            </Text>
          </Box>
          {/* --slate-11, off the text tokens, so set on the wrapper. */}
          <Box style={{ color: "var(--slate-11)", maxWidth: 240 }}>
            <Text as="div" align="center" size="sm">
              {canComment
                ? "Share a thought, ask a question or give the team a heads-up"
                : "No one has said anything about this experiment yet."}
            </Text>
          </Box>
        </Flex>
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
    </Flex>
  );
}

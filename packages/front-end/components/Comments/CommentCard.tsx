import React from "react";
import { Box, Card, Flex } from "@radix-ui/themes";
import { EventUser as EventUserType } from "shared/types/events/event-types";
import EventUser from "@/components/Avatar/EventUser";
import { Size } from "@/ui/Avatar";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import styles from "./CommentCard.module.scss";

export interface CommentCardProps {
  user?: EventUserType | null;
  /**
   * Action phrase after the user, e.g. `"commented on May 5, 2026"`. Rendered
   * as small text-low — pass a plain string, not a pre-styled <Text>.
   */
  metadata: string;
  /**
   * Optional inline elements rendered after `metadata` on the same line
   * (e.g. an `• edited` indicator, badges). Use this for elements that
   * belong in the metadata row but aren't part of the verb phrase itself.
   */
  metadataExtra?: React.ReactNode;
  /**
   * Optional element rendered on the right side of the header
   * (typically a `DropdownMenu` for edit/delete actions).
   */
  actions?: React.ReactNode;
  /**
   * Body content rendered below the header (e.g. a `<Markdown>` block).
   * Omit when the card is event-only (review requested, etc.).
   */
  body?: React.ReactNode;
  /**
   * Radix color scale used for the left accent stripe. Default `"violet"`.
   * E.g. `"green"` for approvals, `"red"` for change requests.
   */
  stripeColor?: string;
  /**
   * Override the leading avatar with a custom element. Size it to match
   * `avatarSize` so the layout stays aligned.
   */
  leading?: React.ReactNode;
  avatarSize?: Size;
  /**
   * Compact layout for narrow panels (the experiment Setup page's rail):
   * a small avatar beside the name and time, no accent stripe, the name alone
   * with the email in a tooltip on hover, and a
   * body that wraps rather than overflowing the card. Optional and additive:
   * existing callers pass nothing and render exactly as before.
   */
  compact?: boolean;
}

/**
 * Shared comment-card chrome used by `DiscussionThread`, `RevisionLog`, and
 * any other surface that renders a comment as a standalone card.
 *
 * Layout: `[avatar] | [card with colored stripe | name-email + metadata | body]`
 */
export default function CommentCard({
  user,
  metadata,
  metadataExtra,
  actions,
  body,
  stripeColor = "violet",
  leading,
  avatarSize = "sm",
  compact = false,
}: CommentCardProps) {
  const email = user && "email" in user ? user.email : "";
  return (
    <Flex align="start" gap="3">
      {compact ? null : (
        <Box flexShrink="0" pt="2">
          {leading ?? (
            <EventUser user={user} display="avatar" size={avatarSize} />
          )}
        </Box>
      )}
      <Card
        size="1"
        className={compact ? styles.compactCard : undefined}
        // minWidth 0 lets the card shrink to its column instead of growing to
        // fit a long word or URL; the body then wraps (compact only, so
        // existing layouts are untouched).
        style={{
          overflow: "hidden",
          flexGrow: 1,
          ...(compact ? { minWidth: 0 } : {}),
        }}
      >
        {/* The coloured accent stripe; hidden in compact (set in review). */}
        {compact ? null : (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 4,
              backgroundColor: `var(--${stripeColor}-9)`,
            }}
          />
        )}
        {/* 4px more on the sides, except in compact, which keeps the card's
          12px all round (set in review). */}
        <Box px={compact ? "0" : "1"}>
          <Flex justify="between" align="center" mb={body ? "2" : "0"} gap="2">
            {compact ? (
              // Compact: the time sits under the name rather than beside it
              // (set in review), with the smallest avatar (24px) to the left
              // of both, 8px away (added back in review): the same as the rail's
              // Owner field, 10px initials included.
              <Flex align="center" gap="2" minWidth="0">
                <Box flexShrink="0" className={styles.compactAvatar}>
                  <EventUser user={user} display="avatar" size="sm" />
                </Box>
                <Flex direction="column" minWidth="0">
                  <Tooltip content={email} enabled={!!email}>
                    <Text as="div" size="sm" weight="medium">
                      <EventUser user={user} display="name" size="sm" />
                    </Text>
                  </Tooltip>
                  <Flex align="center" gap="2" wrap="wrap">
                    {/* --slate-10, the same as the rail's To Do secondary
                    lines (set in review). Off the text tokens, so set on a
                    wrapper that Text inherits from. */}
                    <Box style={{ color: "var(--slate-10)" }}>
                      {/* A block, not an inline span: inline inside the wrapper,
                      it sat in a 20px line box and made the row ~4px taller. */}
                      <Text as="div" size="sm">
                        {metadata}
                      </Text>
                    </Box>
                    {metadataExtra}
                  </Flex>
                </Flex>
              </Flex>
            ) : (
              <Flex align="center" gap="2" wrap="wrap">
                <EventUser user={user} display="name-email" size="sm" />
                <Text color="text-low" size="sm">
                  {metadata}
                </Text>
                {metadataExtra}
              </Flex>
            )}
            {compact && actions ? (
              // Nudged up 4px in compact (set in review). A relative offset,
              // so nothing else in the card moves.
              // Hidden until the comment is hovered (see CommentCard.module.scss).
              <Box
                className={styles.compactActions}
                style={{ position: "relative", top: -4 }}
              >
                {actions}
              </Box>
            ) : (
              actions
            )}
          </Flex>
          {body && (
            <Box
              pt="1"
              style={
                compact
                  ? {
                      overflowWrap: "anywhere",
                      // Lined up with the name: the 24px avatar plus its
                      // 8px gap.
                      paddingLeft: 32,
                    }
                  : undefined
              }
            >
              {body}
            </Box>
          )}
        </Box>
      </Card>
    </Flex>
  );
}

import React from "react";
import { Box, Card, Flex } from "@radix-ui/themes";
import { EventUser as EventUserType } from "shared/types/events/event-types";
import EventUser from "@/components/Avatar/EventUser";
import Text from "@/ui/Text";

export interface CommentCardProps {
  user?: EventUserType | null;
  /**
   * Action phrase displayed after the user, e.g. `"commented on May 5, 2026"`
   * or `"approved on Jun 9, 2026"`. Wrapped in small text-low styling by this
   * component — callers should pass plain strings, not pre-styled <Text>.
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
}

/**
 * Shared comment-card chrome used by `DiscussionThread`, `RevisionLog`, and
 * any other surface that needs a GitHub-style commented-on card.
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
}: CommentCardProps) {
  return (
    <Flex align="start" gap="3">
      <Box flexShrink="0" pt="2">
        <EventUser user={user} display="avatar" size="sm" />
      </Box>
      <Card size="1" style={{ overflow: "hidden", flexGrow: 1 }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            backgroundColor: `var(--${stripeColor}-7)`,
          }}
        />
        <Box px="1">
          <Flex justify="between" align="center" mb={body ? "2" : "0"} gap="2">
            <Flex align="center" gap="2" wrap="wrap">
              <EventUser user={user} display="name-email" size="sm" />
              <Text color="text-low" size="small">
                {metadata}
              </Text>
              {metadataExtra}
            </Flex>
            {actions}
          </Flex>
          {body && <Box pt="1">{body}</Box>}
        </Box>
      </Card>
    </Flex>
  );
}

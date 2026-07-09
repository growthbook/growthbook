import { format } from "date-fns";
import { Box, Flex } from "@radix-ui/themes";
import { PiHourglassHighFill } from "react-icons/pi";
import EventUser from "@/components/Avatar/EventUser";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import Avatar from "@/ui/Avatar";
import {
  revisionStatusColor,
  revisionStatusIcon,
} from "@/components/Reviews/RevisionStatusBadge";

// Compact contributor / reviewer row: small avatar on the left, name on the
// first line, email wrapping naturally on the second. Used in the narrow
// actions column where avatar-name-email inline rows overflow awkwardly.
// Shared between the feature Review & Publish tab and the generic
// (RevisionModel-backed) review surfaces.
export function PersonRow({
  id,
  name,
  email,
  trailing,
}: {
  id: string;
  name: string;
  email: string;
  trailing?: React.ReactNode;
}) {
  const displayName = name || email || "Unknown";
  return (
    <Flex align="start" gap="2">
      <Box flexShrink="0" mt="1">
        <EventUser
          user={{ type: "dashboard", id, name, email }}
          display="avatar"
          size="sm"
        />
      </Box>
      <Box flexGrow="1" style={{ minWidth: 0, lineHeight: 1.3 }}>
        <Text size="small" color="text-high" as="div" overflowWrap="anywhere">
          {displayName}
        </Text>
        {name && email && (
          <Text size="small" color="text-low" as="div" overflowWrap="anywhere">
            {email}
          </Text>
        )}
      </Box>
      {trailing && (
        <Flex flexShrink="0" align="center" style={{ alignSelf: "stretch" }}>
          {trailing}
        </Flex>
      )}
    </Flex>
  );
}

// Compact verdict indicator for the Reviewers widget: the revision-status
// icon in a soft colored circle (same visual language as the timeline's
// inline events), with a tooltip spelling out the state.
export function ReviewerVerdictIcon({
  status,
  name,
  timestamp,
  stale,
}: {
  status: "approved" | "changes-requested";
  name: string;
  timestamp?: string;
  // The draft's content changed after this verdict (see the reviewers memo).
  stale?: boolean;
}) {
  const color = revisionStatusColor(status);
  const who = name || "This reviewer";
  const verdict =
    status === "approved"
      ? `${who} approved these changes`
      : `${who} requested changes`;
  const when = timestamp
    ? ` on ${format(new Date(timestamp), "MMM d, yyyy")}`
    : "";
  const staleNote = stale ? " — the draft has changed since" : "";
  const content = `${verdict}${when}${staleNote}`;
  return (
    <Tooltip content={content}>
      <Box style={{ position: "relative", display: "inline-flex" }}>
        {/* Stale verdicts mute to the soft variant with an hourglass pip —
            still attributable, but visibly not vouching for the current
            draft content. */}
        <Avatar size="sm" color={color} variant={stale ? "soft" : "solid"}>
          <>{revisionStatusIcon(status)}</>
        </Avatar>
        {stale && (
          <Flex
            align="center"
            justify="center"
            style={{
              position: "absolute",
              right: -5,
              bottom: -4,
              color: "var(--gray-10)",
              fontSize: 13,
              // Halo separates the glyph from the chip without boxing it in.
              filter:
                "drop-shadow(0 0 1.5px var(--color-panel-solid)) drop-shadow(0 0 1.5px var(--color-panel-solid))",
            }}
          >
            <PiHourglassHighFill />
          </Flex>
        )}
      </Box>
    </Tooltip>
  );
}

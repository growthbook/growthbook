import { useState } from "react";
import { PiCaretRightFill } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
import { useUser } from "@/services/UserContext";
import EventUser from "@/components/Avatar/EventUser";

// Actions that carry no content change — excluded when deriving co-authors from logs.
export const NON_CONTENT_ACTIONS = new Set([
  "Review Requested",
  "Approved",
  "Requested Changes",
  "Comment",
  "edit comment",
  "publish",
  "re-publish",
  "discard",
]);

interface Props extends MarginProps {
  rev: FeatureRevisionInterface;
  // When provided and rev.contributors is empty, co-authors are derived from
  // content-bearing log entries as a fallback for older revisions.
  logs?: RevisionLog[];
}

export default function CoAuthors({ rev, logs, ...marginProps }: Props) {
  const [open, setOpen] = useState(false);
  const { users } = useUser();

  const createdById =
    rev.createdBy?.type === "dashboard" ? rev.createdBy.id : null;

  // contributors is now string[] (user IDs). For older revisions that lack
  // the field, fall back to deriving from content-bearing log entries.
  const storedIds = (rev.contributors ?? []).filter(Boolean);

  const coAuthorIds =
    storedIds.length === 0 && logs
      ? logs
          .filter(
            (l) =>
              !NON_CONTENT_ACTIONS.has(l.action) &&
              l.user?.type === "dashboard" &&
              l.user.id !== createdById,
          )
          .map((l) => (l.user as { id: string }).id)
          .filter((id, i, arr) => arr.indexOf(id) === i)
      : storedIds.filter((id) => id !== createdById);

  if (coAuthorIds.length === 0) return null;

  const label = `Co-author${coAuthorIds.length > 1 ? "s" : ""} (${coAuthorIds.length})`;

  return (
    <Box {...marginProps}>
      <div
        className="link-purple"
        style={{
          cursor: "pointer",
          userSelect: "none",
          display: "inline-block",
        }}
        onClick={() => setOpen((o) => !o)}
      >
        <PiCaretRightFill
          style={{
            display: "inline",
            marginRight: 4,
            transition: "transform 0.15s ease",
            transform: open ? "rotate(90deg)" : "none",
          }}
        />
        {label}
      </div>
      {open && (
        <Flex direction="column" gap="2" mt="2" ml="3">
          {coAuthorIds.map((id) => {
            const u = users.get(id);
            return (
              <EventUser
                user={{
                  type: "dashboard",
                  id,
                  name: u?.name || "",
                  email: u?.email || "",
                }}
                display="avatar-name-email"
                size="sm"
                wrap={true}
                key={id}
              />
            );
          })}
        </Flex>
      )}
    </Box>
  );
}

import { useState } from "react";
import { PiCaretRightFill } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
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

  const createdById =
    rev.createdBy?.type === "dashboard" ? rev.createdBy.id : null;

  const storedContributors = (rev.contributors ?? []).filter(
    (c): c is NonNullable<typeof c> => c != null,
  );

  const derivedContributors =
    storedContributors.length === 0 && logs
      ? logs
          .filter(
            (l) =>
              !NON_CONTENT_ACTIONS.has(l.action) &&
              l.user?.type === "dashboard",
          )
          .map((l) => l.user!)
          .filter(
            (u, i, arr) =>
              u.type === "dashboard" &&
              arr.findIndex((x) => x.type === "dashboard" && x.id === u.id) ===
                i,
          )
      : storedContributors;

  const coAuthors = derivedContributors.filter(
    (c) => !(c.type === "dashboard" && c.id === createdById),
  );

  if (coAuthors.length === 0) return null;

  const label = `Co-author${coAuthors.length > 1 ? "s" : ""} (${coAuthors.length})`;

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
          {coAuthors.map((c) =>
            c.type === "dashboard" || c.type === "api_key" ? (
              <EventUser
                user={c}
                display="avatar-name-email"
                size="sm"
                wrap={true}
                key={c.type === "dashboard" ? c.id : c.apiKey}
              />
            ) : null,
          )}
        </Flex>
      )}
    </Box>
  );
}

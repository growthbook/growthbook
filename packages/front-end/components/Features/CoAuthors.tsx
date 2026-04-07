import { useState } from "react";
import { PiCaretRightFill } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
import Avatar from "@/components/Avatar/Avatar";

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

interface Props {
  rev: FeatureRevisionInterface;
  // When provided and rev.contributors is empty, co-authors are derived from
  // content-bearing log entries as a fallback for older revisions.
  logs?: RevisionLog[];
  // Applied to the outer Box wrapper (e.g. "1" for mt, "2" for mb).
  mt?: string;
  mb?: string;
}

export default function CoAuthors({ rev, logs, mt, mb }: Props) {
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
    <Box mt={mt as never} mb={mb as never}>
      <div
        className="link-purple"
        style={{ cursor: "pointer", userSelect: "none" }}
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
          {coAuthors.map((c, i) =>
            c.type === "dashboard" ? (
              <Avatar
                key={c.id}
                email={c.email}
                name={c.name ?? ""}
                size={22}
                showEmail
              />
            ) : c.type === "api_key" ? (
              <span key={i} className="badge badge-secondary">
                API Key
              </span>
            ) : null,
          )}
        </Flex>
      )}
    </Box>
  );
}

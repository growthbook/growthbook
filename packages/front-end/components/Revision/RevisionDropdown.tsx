import { ReactNode } from "react";
import {
  Revision,
  getLiveRevision,
  getRevisionNumberById,
} from "shared/enterprise";
import { dateNoYear } from "shared/dates";
import { Flex } from "@radix-ui/themes";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import { DropdownMenuLabel } from "@/ui/DropdownMenu";
import { useUser } from "@/services/UserContext";
import { getStatusBadge } from "@/components/Revision/revisionUtils";
import SharedRevisionDropdown, {
  RevisionDropdownRow,
} from "@/components/Reviews/RevisionDropdown";

export interface RevisionDropdownProps {
  // Used only to scope the "show discarded" preference in localStorage.
  entityId: string;
  allRevisions: Revision[];
  selectedRevisionId: string | null;
  onSelectRevision: (revision: Revision | null) => void;
  requiresApproval?: boolean;
  draftsOnly?: boolean;
  context?: "header";
}

// Generic Revision-model wrapper around the shared <RevisionDropdown> (the same
// core saved groups uses): resolves the live (latest merged) revision, computes
// display version numbers, applies the drafts-only / discarded filtering, and
// renders the author/date metadata and the generic status badge. The shared
// component owns open/scroll/pagination/menu.
export default function RevisionDropdown({
  entityId,
  allRevisions,
  selectedRevisionId,
  onSelectRevision,
  requiresApproval = true,
  draftsOnly = false,
  context,
}: RevisionDropdownProps) {
  const { getUserDisplay } = useUser();

  const [showDiscarded, setShowDiscarded] = useLocalStorage(
    `revisionDropdown__showDiscarded__${entityId}`,
    false,
  );

  // Latest merged revision is "Live".
  const liveRevision = getLiveRevision(allRevisions);

  // Map revision id → display version (stored version, else position by creation).
  const revisionNumberById = getRevisionNumberById(allRevisions);

  const allSorted = [...allRevisions].sort(
    (a, b) =>
      (revisionNumberById.get(b.id) ?? 0) - (revisionNumberById.get(a.id) ?? 0),
  );

  const filteredForDrafts = draftsOnly
    ? allSorted.filter(
        (r) =>
          r.status === "draft" ||
          r.status === "pending-review" ||
          r.status === "changes-requested" ||
          r.status === "approved",
      )
    : allSorted;

  const displayList = showDiscarded
    ? filteredForDrafts
    : filteredForDrafts.filter(
        (r) => r.status !== "discarded" || r.id === selectedRevisionId,
      );

  // Viewing live (selectedRevisionId null) selects the live revision in the list.
  const effectiveSelectedId = selectedRevisionId ?? liveRevision?.id ?? null;

  const buildMeta = (r: Revision): ReactNode => (
    <Text size="small" color="text-low" whiteSpace="nowrap">
      {getUserDisplay(r.authorId)}
      {r.dateUpdated && <> &middot; {dateNoYear(r.dateUpdated)}</>}
    </Text>
  );

  const rows: RevisionDropdownRow[] = displayList.map((r) => {
    const isLive = r.id === liveRevision?.id;
    return {
      key: r.id,
      version: revisionNumberById.get(r.id) ?? 1,
      title: r.title,
      meta: buildMeta(r),
      badge: getStatusBadge(isLive ? "live" : r.status, requiresApproval),
    };
  });

  const discardedCount = allSorted.filter(
    (r) => r.status === "discarded",
  ).length;

  const selectedRevision =
    effectiveSelectedId !== null
      ? (displayList.find((r) => r.id === effectiveSelectedId) ??
        allSorted.find((r) => r.id === effectiveSelectedId))
      : null;

  const toggles =
    discardedCount > 0 ? (
      <DropdownMenuLabel>
        <Flex align="center" gap="2" justify="end" style={{ width: "100%" }}>
          <Text size="small" color="text-low">
            Show discarded ({discardedCount})
          </Text>
          <Switch size="1" value={showDiscarded} onChange={setShowDiscarded} />
        </Flex>
      </DropdownMenuLabel>
    ) : undefined;

  const handleSelect = (key: string) => {
    const revision = allRevisions.find((r) => r.id === key) ?? null;
    // Selecting the live revision views the live state (null).
    if (revision?.id === liveRevision?.id) {
      onSelectRevision(null);
    } else {
      onSelectRevision(revision);
    }
  };

  return (
    <SharedRevisionDropdown
      rows={rows}
      selectedKey={effectiveSelectedId}
      onSelect={handleSelect}
      toggles={toggles}
      selectedBadge={
        selectedRevision
          ? getStatusBadge(
              selectedRevision.id === liveRevision?.id
                ? "live"
                : selectedRevision.status,
              requiresApproval,
            )
          : undefined
      }
      triggerPlaceholder="Select revision"
      triggerNumbered={false}
      context={context}
      menuPlacement="end"
    />
  );
}

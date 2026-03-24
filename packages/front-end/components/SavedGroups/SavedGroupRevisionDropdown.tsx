import { useState, useEffect } from "react";
import { Revision } from "shared/enterprise";
import { dateNoYear } from "shared/dates";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDownBold, PiLockSimple } from "react-icons/pi";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/ui/DropdownMenu";
import Link from "@/ui/Link";
import { useUser } from "@/services/UserContext";
import Badge from "@/ui/Badge";

export interface Props {
  savedGroupId: string;
  allRevisions: Revision[];
  selectedRevisionId: string | null;
  onSelectRevision: (revision: Revision | null) => void;
  requiresApproval?: boolean;
}

function RevisionRow({
  revision,
  liveRevisionId,
  revisionNumber,
  requiresApproval = true,
}: {
  revision: Revision;
  liveRevisionId: string | null;
  revisionNumber: number;
  requiresApproval?: boolean;
}) {
  const { getUserDisplay } = useUser();
  const isLive = revision.id === liveRevisionId;
  const revDate = revision.dateUpdated;

  return (
    <Flex align="center" justify="between" gap="3" style={{ width: "100%" }}>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text weight="semibold">
          <span
            style={{
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 400,
            }}
            title={revision.title || `Revision ${revisionNumber}`}
          >
            <span
              style={{
                display: "inline-block",
                minWidth: "1.9em",
                paddingRight: ".4em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <Text as="span" color="text-mid" size="small">
                {revisionNumber}.
              </Text>
            </span>
            {revision.title || `Revision ${revisionNumber}`}
          </span>
        </Text>
      </Box>
      <Box
        flexShrink="1"
        overflow="hidden"
        style={{ textOverflow: "ellipsis" }}
      >
        <Text size="small" color="text-low" whiteSpace="nowrap">
          {getUserDisplay(revision.authorId)}
          {revDate && <> &middot; {dateNoYear(revDate)}</>}
        </Text>
      </Box>
      <Box flexShrink="0">
        {isLive ? (
          <Badge label="Live" color="teal" radius="full" />
        ) : revision.status === "merged" ? (
          <Flex align="center" gap="1">
            <PiLockSimple size={14} />
            <Badge label="Locked" color="gray" radius="full" />
          </Flex>
        ) : revision.status === "closed" ? (
          <Badge label="Closed" color="gray" radius="full" />
        ) : revision.status === "approved" ? (
          <Badge label="Approved" color="blue" radius="full" />
        ) : revision.status === "changes-requested" ? (
          <Badge label="Changes Requested" color="orange" radius="full" />
        ) : revision.status === "pending-review" ? (
          // Show as "Draft" if approvals are not required
          <Badge
            label={requiresApproval ? "Pending Review" : "Draft"}
            color={requiresApproval ? "yellow" : "indigo"}
            radius="full"
          />
        ) : revision.status === "draft" ? (
          <Badge label="Draft" color="indigo" radius="full" />
        ) : null}
      </Box>
    </Flex>
  );
}

export default function SavedGroupRevisionDropdown({
  savedGroupId,
  allRevisions,
  selectedRevisionId,
  onSelectRevision,
  requiresApproval = true,
}: Props) {
  const initialPageSize = 5;

  const [open, setOpen] = useState(false);
  const [extraShown, setExtraShown] = useState(0);

  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => {
        document
          .querySelector(".rt-DropdownMenuContent .selected-item")
          ?.scrollIntoView({ block: "nearest" });
      });
      return () => cancelAnimationFrame(frame);
    } else {
      setExtraShown(0);
    }
  }, [open]);

  const [showDiscarded, setShowDiscarded] = useLocalStorage(
    `savedGroupRevisionDropdown__showDiscarded__${savedGroupId}`,
    false,
  );

  // Find the latest merged revision to use for "Live"
  const liveRevision = [...allRevisions]
    .filter((r) => r.status === "merged")
    .sort(
      (a, b) =>
        new Date(b.dateUpdated).getTime() - new Date(a.dateUpdated).getTime(),
    )[0];

  // Create a map of revision ID to revision number
  const sortedAllRevisions = [...allRevisions].sort(
    (a, b) =>
      new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime(),
  );

  const revisionNumberById = new Map<string, number>(
    allRevisions.map((revision) => {
      const version =
        revision.version ??
        sortedAllRevisions.findIndex((r) => r.id === revision.id) + 1;
      return [revision.id, version];
    }),
  );

  // Sort by version number (descending)
  const allSorted = [...allRevisions].sort(
    (a, b) =>
      (revisionNumberById.get(b.id) ?? 0) - (revisionNumberById.get(a.id) ?? 0),
  );

  // Show all revisions, optionally filtering discarded
  const displayList = showDiscarded
    ? allSorted
    : allSorted.filter(
        (r) => r.status !== "closed" || r.id === selectedRevisionId,
      );

  // When viewing live (selectedRevisionId is null), find the live revision in the list
  const effectiveSelectedId = selectedRevisionId ?? liveRevision?.id ?? null;

  const selectedIndex =
    effectiveSelectedId === null
      ? -1
      : displayList.findIndex((r) => r.id === effectiveSelectedId);
  const baseWindow = Math.max(
    initialPageSize,
    selectedIndex >= 0 ? selectedIndex + 1 : 0,
  );
  const windowSize = baseWindow + extraShown;
  const shown = displayList.slice(0, windowSize);
  const remaining = displayList.length - windowSize;

  const selectedRevision =
    effectiveSelectedId !== null
      ? (shown.find((r) => r.id === effectiveSelectedId) ??
        allSorted.find((r) => r.id === effectiveSelectedId))
      : null;

  const handleSelect = (revisionId: string) => {
    // If selecting the live revision, pass null to view live state
    const revision = allRevisions.find((r) => r.id === revisionId) ?? null;
    if (revision?.id === liveRevision?.id) {
      onSelectRevision(null);
    } else {
      onSelectRevision(revision);
    }
    setOpen(false);
  };

  const menuItems = shown.map((r) => (
    <DropdownMenuItem
      key={r.id}
      className={`multiline-item${r.id === effectiveSelectedId ? " selected-item" : ""}`}
      onClick={() => handleSelect(r.id)}
    >
      <RevisionRow
        revision={r}
        liveRevisionId={liveRevision?.id ?? null}
        revisionNumber={revisionNumberById.get(r.id) ?? 1}
        requiresApproval={requiresApproval}
      />
    </DropdownMenuItem>
  ));

  const discardedCount = allSorted.filter((r) => r.status === "closed").length;

  const triggerWidth = 430;
  const selectedRevisionNumber = selectedRevision
    ? (revisionNumberById.get(selectedRevision.id) ?? 1)
    : null;

  const trigger = (
    <Flex
      align="center"
      justify="between"
      gap="3"
      style={{ width: triggerWidth, overflow: "hidden" }}
    >
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text weight="semibold">
          {selectedRevision && selectedRevisionNumber !== null ? (
            <span
              style={{
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 400,
              }}
              title={
                selectedRevision.title || `Revision ${selectedRevisionNumber}`
              }
            >
              <span
                style={{
                  display: "inline-block",
                  minWidth: "1.9em",
                  paddingRight: ".4em",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <Text as="span" color="text-mid" size="small">
                  {selectedRevisionNumber}.
                </Text>
              </span>
              {selectedRevision.title || `Revision ${selectedRevisionNumber}`}
            </span>
          ) : (
            "Select revision"
          )}
        </Text>
      </Box>
      <Box flexShrink="0">
        {selectedRevision ? (
          selectedRevision.id === liveRevision?.id ? (
            <Badge label="Live" color="teal" radius="full" />
          ) : selectedRevision.status === "merged" ? (
            <Flex align="center" gap="1">
              <PiLockSimple size={14} />
              <Badge label="Locked" color="gray" radius="full" />
            </Flex>
          ) : selectedRevision.status === "closed" ? (
            <Badge label="Closed" color="gray" radius="full" />
          ) : selectedRevision.status === "approved" ? (
            <Badge label="Approved" color="blue" radius="full" />
          ) : selectedRevision.status === "changes-requested" ? (
            <Badge label="Changes Requested" color="orange" radius="full" />
          ) : (
            <Badge label="Draft" color="indigo" radius="full" />
          )
        ) : null}
      </Box>
      <PiCaretDownBold style={{ flexShrink: 0 }} />
    </Flex>
  );

  return (
    <DropdownMenu
      variant="soft"
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      triggerClassName="dropdown-trigger-select-style"
      menuWidth="full"
      menuPlacement="end"
    >
      {discardedCount > 0 && (
        <DropdownMenuLabel>
          <Flex align="center" gap="2" justify="end" style={{ width: "100%" }}>
            <Text size="small" color="text-low">
              Show discarded ({discardedCount})
            </Text>
            <Switch
              size="1"
              value={showDiscarded}
              onChange={setShowDiscarded}
            />
          </Flex>
        </DropdownMenuLabel>
      )}
      {menuItems}
      {remaining > 0 && (
        <DropdownMenuLabel>
          <Link
            size="2"
            onClick={() => setExtraShown((prev) => prev + remaining)}
          >
            Show all ({remaining} more)
          </Link>
        </DropdownMenuLabel>
      )}
    </DropdownMenu>
  );
}

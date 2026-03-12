import React, { useState, useEffect } from "react";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { datetime, date as formatDate } from "shared/dates";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { revisionLabel } from "shared/util";

import { DropdownMenu as RadixDropdownMenu, Box, Flex } from "@radix-ui/themes";
import { PiCaretDownBold } from "react-icons/pi";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Heading from "@/ui/Heading";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import Link from "@/ui/Link";
import { useUser } from "@/services/UserContext";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import EventUser from "@/components/Avatar/EventUser";
import RevisionStatusBadge from "@/components/Features/RevisionStatusBadge";

export interface Props {
  feature: FeatureInterface;
  revisions: MinimalFeatureRevisionInterface[];
  /** Currently selected version. Pass `null` to indicate "New Draft" (only meaningful with `draftsOnly`). */
  version: number | null;
  setVersion: (version: number) => void;
  variant?: "slim" | "select";
  menuPlacement?: "start" | "center" | "end";
  /**
   * When true, only active drafts are shown plus a "New Draft" option.
   * Use `onVersionChange` instead of `setVersion` to receive `null` for "New Draft".
   */
  draftsOnly?: boolean;
  /**
   * Local onChange used in draftsOnly mode. Receives `null` when "New Draft" is selected.
   * Does NOT call `setVersion` (won't mutate the page-level version state).
   */
  onVersionChange?: (version: number | null) => void;
  disabled?: boolean;
  /**
   * When provided, replaces the built-in trigger entirely. The element must
   * forward a ref and accept onClick so Radix can open the menu.
   */
  customTrigger?: React.ReactNode;
  /** Suppress the "New Draft" option even in draftsOnly mode. */
  hideNewDraft?: boolean;
  /**
   * Called when "New Draft" is clicked. When provided, the click will call
   * this handler instead of the default (no-op) behaviour, allowing the parent
   * to show a confirmation modal before creating the draft.
   */
  onNewDraft?: () => void;
}

/** Like `date()` but omits the year when it matches the current calendar year. */
function dateNoCurrentYear(d: string | Date): string {
  const str = formatDate(d);
  const currentYear = new Date().getFullYear().toString();
  return str.endsWith(`, ${currentYear}`)
    ? str.slice(0, -`, ${currentYear}`.length)
    : str;
}

function RevisionRow({
  r,
  liveVersion,
}: {
  r: MinimalFeatureRevisionInterface;
  liveVersion: number;
}) {
  const revDate = r.status === "published" ? r.datePublished : r.dateUpdated;
  return (
    <Flex align="center" justify="between" gap="3" style={{ width: "100%" }}>
      <Box flexShrink="0">
        <Heading as="h4" size="x-small" mb="0">
          <OverflowText maxWidth={200}>
            {revisionLabel(r.version, r.title)}
          </OverflowText>
        </Heading>
      </Box>
      <Box flexGrow="1" />
      {/* Right: metadata + status, vertically centered */}
      <Box
        flexShrink="1"
        overflow="hidden"
        style={{ textOverflow: "ellipsis" }}
      >
        {(r.createdBy || revDate) && (
          <Text size="small" color="text-low" whiteSpace="nowrap">
            {r.createdBy && <EventUser user={r.createdBy} display="name" />}
            {r.createdBy && revDate && <> &middot; </>}
            {revDate && datetime(revDate)}
          </Text>
        )}
      </Box>
      <Box flexShrink="0">
        <RevisionStatusBadge revision={r} liveVersion={liveVersion} />
      </Box>
    </Flex>
  );
}

export default function RevisionDropdown({
  feature,
  revisions,
  version,
  setVersion,
  variant = "slim",
  menuPlacement = "end",
  draftsOnly = false,
  onVersionChange,
  disabled = false,
  customTrigger,
  hideNewDraft = false,
  onNewDraft,
}: Props) {
  const liveVersion = feature.version;
  const initialPageSize = 10;

  const { userId } = useUser();

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

  type RevisionTab = "all-drafts" | "my-drafts" | "all-revisions";
  const [revisionTab, setRevisionTab] = useLocalStorage<RevisionTab>(
    "revisionDropdown__tab",
    "all-drafts",
  );
  const [showDiscarded, setShowDiscarded] = useLocalStorage(
    `revisionDropdown__showDiscarded__${feature.id}`,
    false,
  );

  const allSorted = [...revisions].sort((a, b) => b.version - a.version);

  // Live revision is always pinned at the top; exclude from the scrollable list.
  const liveRevision = allSorted.find((r) => r.version === liveVersion) ?? null;
  const withoutLive = allSorted.filter((r) => r.version !== liveVersion);

  const isMyRevision = (r: MinimalFeatureRevisionInterface) =>
    r.createdBy != null &&
    "id" in r.createdBy &&
    (r.createdBy as { id?: string }).id === userId;

  const activeDrafts = (r: MinimalFeatureRevisionInterface) =>
    (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status);

  // In draftsOnly mode show only active drafts; no pagination/tab/discard toggle needed.
  const displayList = draftsOnly
    ? withoutLive.filter(activeDrafts)
    : revisionTab === "all-drafts"
      ? withoutLive.filter(activeDrafts)
      : revisionTab === "my-drafts"
        ? withoutLive.filter((r) => activeDrafts(r) && isMyRevision(r))
        : showDiscarded
          ? withoutLive
          : withoutLive.filter(
              (r) => r.status !== "discarded" || r.version === version,
            );

  // In normal mode apply the sliding window; draftsOnly shows all at once.
  const selectedIndex = draftsOnly
    ? -1
    : displayList.findIndex((r) => r.version === version);
  const baseWindow = draftsOnly
    ? displayList.length
    : Math.max(initialPageSize, selectedIndex >= 0 ? selectedIndex + 1 : 0);
  const windowSize = baseWindow + extraShown;
  const shown = displayList.slice(0, windowSize);
  const remaining = displayList.length - windowSize;

  const selectedRevision =
    version !== null
      ? (shown.find((r) => r.version === version) ??
        allSorted.find((r) => r.version === version))
      : null;

  const selectedMeta = selectedRevision;
  const triggerDate =
    selectedMeta?.status === "published"
      ? selectedMeta?.datePublished
      : selectedMeta?.dateUpdated;

  const handleSelect = (v: number | null) => {
    if (onVersionChange) {
      onVersionChange(v);
    } else if (v !== null) {
      setVersion(v);
    }
    setOpen(false);
  };

  const liveItem =
    !draftsOnly && liveRevision ? (
      <DropdownMenuItem
        key={liveRevision.version}
        className={`multiline-item${liveRevision.version === version ? " selected-item" : ""}`}
        onClick={() => handleSelect(liveRevision.version)}
      >
        <RevisionRow r={liveRevision} liveVersion={liveVersion} />
      </DropdownMenuItem>
    ) : null;

  const menuItems: React.ReactNode[] = shown.map((r) => (
    <DropdownMenuItem
      key={r.version}
      className={`multiline-item${r.version === version ? " selected-item" : ""}`}
      onClick={() => handleSelect(r.version)}
    >
      <RevisionRow r={r} liveVersion={liveVersion} />
    </DropdownMenuItem>
  ));

  // "New Draft" option — always shown in draftsOnly mode; also shown in
  // full-list mode when an onNewDraft handler is provided (e.g. from FeaturesHeader).
  const showNewDraft = !hideNewDraft && (draftsOnly || !!onNewDraft);
  const newDraftItem = showNewDraft ? (
    <DropdownMenuItem
      key="__new__"
      className={`multiline-item${version === null ? " selected-item" : ""}`}
      onClick={() => {
        if (onNewDraft) {
          setOpen(false);
          onNewDraft();
        } else {
          handleSelect(null);
        }
      }}
    >
      <Flex align="center" gap="3" style={{ width: "100%" }}>
        <Heading as="h4" size="x-small" mb="0">
          New Draft
        </Heading>
        <Box flexGrow="1" />
        <Text size="small" color="text-low">
          Branch from live revision
        </Text>
      </Flex>
    </DropdownMenuItem>
  ) : null;

  const discardedCount = allSorted.filter(
    (r) => r.status === "discarded",
  ).length;

  const builtInTrigger = (
    <Flex
      align="center"
      justify="between"
      gap="3"
      style={{
        width: "100%",
        overflow: "hidden",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : undefined,
      }}
    >
      {/* Left: revision label */}
      <Box flexShrink="0">
        <Heading as="h4" size="x-small" mb="0">
          {version === null ? (
            "New Draft"
          ) : (
            <OverflowText maxWidth={200}>
              {revisionLabel(version, selectedRevision?.title)}
            </OverflowText>
          )}
        </Heading>
      </Box>
      <Box flexGrow="1" />
      {/* Right: metadata + status + caret, vertically centered */}
      <Box
        flexShrink="1"
        overflow="hidden"
        style={{ textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {(selectedMeta?.createdBy || (triggerDate && !disabled)) && (
          <Text size="small" color="text-low" whiteSpace="nowrap">
            {selectedMeta?.createdBy && (
              <EventUser user={selectedMeta.createdBy} display="name" />
            )}
            {selectedMeta?.createdBy && triggerDate && !disabled && (
              <> &middot; </>
            )}
            {triggerDate && !disabled && dateNoCurrentYear(triggerDate)}
          </Text>
        )}
      </Box>
      {(selectedMeta || !draftsOnly) && (
        <Box flexShrink="0">
          <RevisionStatusBadge
            revision={selectedMeta}
            liveVersion={liveVersion}
          />
        </Box>
      )}
      <PiCaretDownBold style={{ flexShrink: 0 }} />
    </Flex>
  );

  return (
    <DropdownMenu
      variant="soft"
      open={disabled ? false : open}
      onOpenChange={disabled ? undefined : setOpen}
      trigger={customTrigger ?? builtInTrigger}
      triggerClassName={
        customTrigger
          ? undefined
          : variant === "select"
            ? "dropdown-trigger-select-style"
            : "dropdown-trigger-slim-style"
      }
      menuWidth="full"
      menuPlacement={menuPlacement}
    >
      {!draftsOnly && (
        <Box pb="2">
          <Tabs
            value={revisionTab}
            onValueChange={(v) => {
              setRevisionTab(v as RevisionTab);
              setExtraShown(0);
            }}
            style={{ width: "100%" }}
          >
            <TabsList size="1" style={{ width: "100%" }}>
              <TabsTrigger
                value="all-drafts"
                style={{ paddingInline: "var(--space-3)" }}
              >
                All drafts
              </TabsTrigger>
              <TabsTrigger
                value="my-drafts"
                style={{ paddingInline: "var(--space-3)" }}
              >
                My drafts
              </TabsTrigger>
              <TabsTrigger
                value="all-revisions"
                style={{ paddingInline: "var(--space-3)" }}
              >
                All revisions
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </Box>
      )}
      {liveItem}
      {(menuItems.length > 0 ||
        newDraftItem ||
        (!draftsOnly &&
          revisionTab === "all-revisions" &&
          discardedCount > 0)) &&
        liveItem && <DropdownMenuSeparator />}
      {!draftsOnly && revisionTab === "all-revisions" && discardedCount > 0 && (
        <RadixDropdownMenu.Label>
          <Flex justify="end" align="center" gap="2" style={{ width: "100%" }}>
            <Text size="small" color="text-low">
              Show discarded ({discardedCount})
            </Text>
            <Switch
              size="1"
              value={showDiscarded}
              onChange={setShowDiscarded}
            />
          </Flex>
        </RadixDropdownMenu.Label>
      )}
      {menuItems}
      {newDraftItem}
      {remaining > 0 && (
        <RadixDropdownMenu.Label>
          <Link
            size="2"
            onClick={() => setExtraShown((prev) => prev + remaining)}
          >
            Show all ({remaining} more)
          </Link>
        </RadixDropdownMenu.Label>
      )}
    </DropdownMenu>
  );
}

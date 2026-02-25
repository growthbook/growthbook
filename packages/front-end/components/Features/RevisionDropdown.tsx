import { useState, useEffect } from "react";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { datetime } from "shared/dates";

import { DropdownMenu as RadixDropdownMenu, Box, Flex } from "@radix-ui/themes";
import { PiCaretDownBold } from "react-icons/pi";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Heading from "@/ui/Heading";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Link from "@/ui/Link";
import EventUser from "@/components/Avatar/EventUser";
import LoadingOverlay from "@/components/LoadingOverlay";
import LoadingSpinner from "@/components/LoadingSpinner";
import RevisionStatusBadge from "@/components/Features/RevisionStatusBadge";

export interface Props {
  feature: FeatureInterface;
  revisions: MinimalFeatureRevisionInterface[];
  loading?: boolean;
  revisionLoading?: boolean;
  version: number;
  setVersion: (version: number) => void;
}

function RevisionRow({
  r,
  liveVersion,
}: {
  r: MinimalFeatureRevisionInterface;
  liveVersion: number;
}) {
  const date = r.status === "published" ? r.datePublished : r.dateUpdated;
  return (
    <Flex align="center" justify="between" gap="3" style={{ width: "100%" }}>
      <Heading as="h3" size="small" mb="0">
        Revision {r.version}
      </Heading>
      <Box flexGrow="1" />
      <Box
        flexShrink="1"
        overflow="hidden"
        style={{ textOverflow: "ellipsis" }}
      >
        {date && (
          <Text size="small" color="text-low">
            Created {datetime(date)} by{" "}
            <EventUser user={r.createdBy} display="name" />
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
  loading = false,
  revisionLoading = false,
  version,
  setVersion,
}: Props) {
  const liveVersion = feature.version;
  const pageSize = 25;

  const [open, setOpen] = useState(false);
  const [extraShown, setExtraShown] = useState(0);

  useEffect(() => {
    if (!open) return;
    // wait for Radix portal to render before querying the DOM
    const frame = requestAnimationFrame(() => {
      document
        .querySelector(".rt-DropdownMenuContent .selected-item")
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const [showDiscarded, setShowDiscarded] = useLocalStorage(
    `revisionDropdown__showDiscarded__${feature.id}`,
    false,
  );

  const allSorted = [...revisions].sort((a, b) => b.version - a.version);

  // When not showing discarded, exclude them except for the currently selected one
  const nonDiscarded = showDiscarded
    ? allSorted
    : allSorted.filter(
        (r) => r.status !== "discarded" || r.version === version,
      );

  // Always extend the window far enough to include the selected revision
  const selectedIndex = nonDiscarded.findIndex((r) => r.version === version);
  const baseWindow = Math.max(
    pageSize,
    selectedIndex >= 0 ? selectedIndex + 1 : 0,
  );
  const windowSize = baseWindow + extraShown;
  const shown = nonDiscarded.slice(0, windowSize);
  const remaining = nonDiscarded.length - windowSize;

  const selectedRevision =
    shown.find((r) => r.version === version) ??
    allSorted.find((r) => r.version === version);

  const selectedMeta = selectedRevision;
  const triggerDate =
    selectedMeta?.status === "published"
      ? selectedMeta?.datePublished
      : selectedMeta?.dateUpdated;

  const menuItems: React.ReactNode[] = shown.map((r) => (
    <DropdownMenuItem
      key={r.version}
      className={`multiline-item${r.version === version ? " selected-item" : ""}`}
      onClick={() => {
        setVersion(r.version);
        setOpen(false);
      }}
    >
      <RevisionRow r={r} liveVersion={liveVersion} />
    </DropdownMenuItem>
  ));

  const discardedCount = allSorted.filter(
    (r) => r.status === "discarded",
  ).length;

  return (
    <DropdownMenu
      variant="soft"
      open={open}
      onOpenChange={(o) => {
        if (!o) setExtraShown(0);
        setOpen(o);
      }}
      trigger={
        <Flex
          align="center"
          justify="between"
          gap="3"
          style={{ width: "100%", overflow: "hidden" }}
        >
          {loading && <LoadingOverlay />}
          {revisionLoading && <LoadingSpinner />}
          <Heading as="h3" size="small" mb="0">
            Revision {version}
          </Heading>
          <Box flexGrow="1" />
          <Box
            flexShrink="1"
            overflow="hidden"
            style={{ textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {triggerDate && (
              <Text size="small" color="text-low" whiteSpace="nowrap">
                Created {datetime(triggerDate)} by{" "}
                <EventUser user={selectedMeta?.createdBy} display="name" />
              </Text>
            )}
          </Box>
          <Box flexShrink="0">
            <RevisionStatusBadge
              revision={selectedMeta}
              liveVersion={liveVersion}
            />
          </Box>
          <PiCaretDownBold style={{ flexShrink: 0 }} />
        </Flex>
      }
      triggerClassName="dropdown-trigger-select-style"
      menuWidth="full"
    >
      {discardedCount > 0 && (
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
      {remaining > 0 && (
        <RadixDropdownMenu.Label>
          <Link
            size="1"
            onClick={() => setExtraShown((prev) => prev + pageSize)}
          >
            Show {Math.min(pageSize, remaining)} more
          </Link>
        </RadixDropdownMenu.Label>
      )}
    </DropdownMenu>
  );
}

import { useState, useEffect } from "react";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { datetime, date as formatDate } from "shared/dates";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { DropdownMenu as RadixDropdownMenu, Box, Flex } from "@radix-ui/themes";
import { PiCaretDownBold } from "react-icons/pi";
import RevisionLabel, {
  revisionLabelText,
} from "@/components/Features/RevisionLabel";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Link from "@/ui/Link";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import EventUser from "@/components/Avatar/EventUser";
import RevisionStatusBadge from "@/components/Features/RevisionStatusBadge";

export interface Props {
  feature: FeatureInterface;
  revisions: MinimalFeatureRevisionInterface[];
  version: number | null;
  setVersion: (version: number) => void;
  variant?: "slim" | "select";
  menuPlacement?: "start" | "center" | "end";
  draftsOnly?: boolean;
  // Show only previously-published revisions
  publishedOnly?: boolean;
}

// Like date() but omits the year when it matches the current year
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
  fullWidth = false,
  publishedOnly = false,
}: {
  r: MinimalFeatureRevisionInterface;
  liveVersion: number;
  fullWidth?: boolean;
  publishedOnly?: boolean;
}) {
  // publishedOnly: datePublished (fallback: dateUpdated); otherwise: datePublished for published, dateUpdated for drafts
  const revDate = publishedOnly
    ? (r.datePublished ?? r.dateUpdated)
    : r.status === "published"
      ? r.datePublished
      : r.dateUpdated;
  return (
    <Flex align="center" justify="between" gap="3" style={{ width: "100%" }}>
      {fullWidth ? (
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
              title={revisionLabelText(r.version, r.title)}
            >
              <RevisionLabel version={r.version} title={r.title} />
            </span>
          </Text>
        </Box>
      ) : (
        <>
          <Box flexShrink="0">
            <Text weight="semibold">
              <OverflowText
                maxWidth={250}
                title={revisionLabelText(r.version, r.title)}
              >
                <RevisionLabel version={r.version} title={r.title} />
              </OverflowText>
            </Text>
          </Box>
          <Box flexGrow="1" />
        </>
      )}
      <Box
        flexShrink="1"
        overflow="hidden"
        style={{ textOverflow: "ellipsis" }}
      >
        {publishedOnly
          ? revDate && (
              <Text size="small" color="text-low" whiteSpace="nowrap">
                Published: {datetime(revDate)}
              </Text>
            )
          : (r.createdBy || revDate) && (
              <Text size="small" color="text-low" whiteSpace="nowrap">
                {r.createdBy && <EventUser user={r.createdBy} display="name" />}
                {r.createdBy && revDate && <> &middot; </>}
                {revDate && datetime(revDate)}
              </Text>
            )}
      </Box>
      {!publishedOnly && (
        <Box flexShrink="0">
          <RevisionStatusBadge revision={r} liveVersion={liveVersion} />
        </Box>
      )}
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
  publishedOnly = false,
}: Props) {
  const liveVersion = feature.version;
  const initialPageSize = 10;

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
    `revisionDropdown__showDiscarded__${feature.id}`,
    false,
  );

  const allSorted = [...revisions].sort((a, b) => b.version - a.version);
  const withoutLive = allSorted.filter((r) => r.version !== liveVersion);

  const activeDrafts = (r: MinimalFeatureRevisionInterface) =>
    (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status);

  const displayList = publishedOnly
    ? withoutLive.filter((r) => r.status === "published")
    : draftsOnly
      ? withoutLive.filter(activeDrafts)
      : showDiscarded
        ? allSorted
        : allSorted.filter(
            (r) => r.status !== "discarded" || r.version === version,
          );

  // Pinned quick-access section: live revision + up to 3 most recent drafts.
  // Only shown in the default (non-draftsOnly, non-publishedOnly) mode.
  const showPinnedSection =
    !draftsOnly && !publishedOnly && allSorted.length > 5;
  const pinnedLive = showPinnedSection
    ? (allSorted.find((r) => r.version === liveVersion) ?? null)
    : null;
  const pinnedDrafts = showPinnedSection
    ? allSorted.filter(activeDrafts).slice(0, 3)
    : [];
  const pinnedRevisions: MinimalFeatureRevisionInterface[] = [
    ...(pinnedLive ? [pinnedLive] : []),
    ...pinnedDrafts,
  ];

  const selectedIndex =
    draftsOnly || publishedOnly
      ? -1
      : displayList.findIndex((r) => r.version === version);
  const baseWindow =
    draftsOnly || publishedOnly
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
  const triggerDate = publishedOnly
    ? (selectedMeta?.datePublished ?? selectedMeta?.dateUpdated)
    : selectedMeta?.status === "published"
      ? selectedMeta?.datePublished
      : selectedMeta?.dateUpdated;

  const handleSelect = (v: number) => {
    setVersion(v);
    setOpen(false);
  };

  const menuItems: React.ReactNode[] = shown.map((r) => (
    <DropdownMenuItem
      key={r.version}
      className={`multiline-item${r.version === version ? " selected-item" : ""}`}
      onClick={() => handleSelect(r.version)}
    >
      <RevisionRow
        r={r}
        liveVersion={liveVersion}
        fullWidth={variant === "select"}
        publishedOnly={publishedOnly}
      />
    </DropdownMenuItem>
  ));

  const discardedCount = allSorted.filter(
    (r) => r.status === "discarded",
  ).length;

  const trigger = (
    <Flex
      align="center"
      justify="between"
      gap="3"
      style={{ width: "100%", overflow: "hidden" }}
    >
      {variant === "select" ? (
        // In select mode: grow to fill space so badge + caret stay visible on the right
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text weight="semibold">
            {version != null ? (
              <span
                style={{
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 400,
                }}
                title={revisionLabelText(version, selectedRevision?.title)}
              >
                <RevisionLabel
                  numbered={!!selectedRevision?.title}
                  version={version}
                  title={selectedRevision?.title}
                />
              </span>
            ) : null}
          </Text>
        </Box>
      ) : (
        <Box flexShrink="0">
          <Text weight="semibold">
            {version != null ? (
              <OverflowText
                maxWidth={150}
                title={revisionLabelText(version, selectedRevision?.title)}
              >
                <RevisionLabel
                  numbered={!!selectedRevision?.title}
                  version={version}
                  title={selectedRevision?.title}
                />
              </OverflowText>
            ) : null}
          </Text>
        </Box>
      )}
      {variant !== "slim" && variant !== "select" && <Box flexGrow="1" />}
      <Box
        flexShrink="1"
        overflow="hidden"
        style={{ textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {publishedOnly
          ? triggerDate && (
              <Text size="small" color="text-low" whiteSpace="nowrap">
                Published: {dateNoCurrentYear(triggerDate)}
              </Text>
            )
          : (selectedMeta?.createdBy || triggerDate) && (
              <Text size="small" color="text-low" whiteSpace="nowrap">
                {selectedMeta?.createdBy && (
                  <EventUser user={selectedMeta.createdBy} display="name" />
                )}
                {selectedMeta?.createdBy && triggerDate && <> &middot; </>}
                {triggerDate && dateNoCurrentYear(triggerDate)}
              </Text>
            )}
      </Box>
      {!publishedOnly && (selectedMeta || !draftsOnly) && (
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
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      triggerClassName={
        variant === "select"
          ? "dropdown-trigger-select-style"
          : "dropdown-trigger-slim-style"
      }
      menuWidth="full"
      menuPlacement={menuPlacement}
    >
      {pinnedRevisions.map((r) => (
        <DropdownMenuItem
          key={`pinned-${r.version}`}
          className="multiline-item"
          onClick={() => handleSelect(r.version)}
        >
          <RevisionRow r={r} liveVersion={liveVersion} />
        </DropdownMenuItem>
      ))}
      {showPinnedSection && (
        <>
          {pinnedRevisions.length > 0 && <DropdownMenuSeparator />}
          <RadixDropdownMenu.Label>
            <Flex
              justify="between"
              align="center"
              gap="2"
              style={{ width: "100%" }}
            >
              <Text size="medium" color="text-mid">
                All revisions
              </Text>
              {!draftsOnly && !publishedOnly && discardedCount > 0 && (
                <Flex align="center" gap="2">
                  <Text size="small" color="text-low">
                    Show discarded ({discardedCount})
                  </Text>
                  <Switch
                    size="1"
                    value={showDiscarded}
                    onChange={setShowDiscarded}
                  />
                </Flex>
              )}
            </Flex>
          </RadixDropdownMenu.Label>
        </>
      )}
      {menuItems}
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

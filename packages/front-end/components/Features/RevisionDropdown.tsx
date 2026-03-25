import { useState, useEffect } from "react";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { dateNoYear } from "shared/dates";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { DropdownMenu as RadixDropdownMenu, Box, Flex } from "@radix-ui/themes";
import { PiCaretDownBold } from "react-icons/pi";
import RevisionLabel, {
  revisionLabelText,
} from "@/components/Features/RevisionLabel";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Link from "@/ui/Link";
import EventUser from "@/components/Avatar/EventUser";
import RevisionStatusBadge, {
  isRampGenerated,
} from "@/components/Features/RevisionStatusBadge";

export interface Props {
  feature: FeatureInterface;
  revisions: MinimalFeatureRevisionInterface[];
  version: number | null;
  setVersion: (version: number) => void;
  context?: "header";
  menuPlacement?: "start" | "center" | "end";
  draftsOnly?: boolean;
  // Show only previously-published revisions
  publishedOnly?: boolean;
}

function RevisionRow({
  r,
  liveVersion,
  publishedOnly = false,
}: {
  r: MinimalFeatureRevisionInterface;
  liveVersion: number;
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
      <Box
        flexShrink="1"
        overflow="hidden"
        style={{ textOverflow: "ellipsis" }}
      >
        {publishedOnly
          ? revDate && (
              <Text size="small" color="text-low" whiteSpace="nowrap">
                Published: {dateNoYear(revDate)}
              </Text>
            )
          : (r.createdBy || revDate) && (
              <Text size="small" color="text-low" whiteSpace="nowrap">
                {r.createdBy?.type === "system" ? (
                  <em>generated</em>
                ) : r.createdBy ? (
                  <EventUser user={r.createdBy} display="name" />
                ) : null}
                {r.createdBy && revDate && <> &middot; </>}
                {revDate && dateNoYear(revDate)}
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
  context,
  menuPlacement = "end",
  draftsOnly = false,
  publishedOnly = false,
}: Props) {
  const liveVersion = feature.version;
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
    `revisionDropdown__showDiscarded__${feature.id}`,
    false,
  );
  const [showGenerated, setShowGenerated] = useLocalStorage(
    `revisionDropdown__showGenerated__${feature.id}`,
    false,
  );

  const allSorted = [...revisions].sort((a, b) => b.version - a.version);
  const withoutLive = allSorted.filter((r) => r.version !== liveVersion);

  const activeDrafts = (r: MinimalFeatureRevisionInterface) =>
    (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status);

  const displayList = publishedOnly
    ? withoutLive.filter((r) => r.status === "published")
    : draftsOnly
      ? withoutLive
          .filter(activeDrafts)
          .filter(
            (r) =>
              showGenerated ||
              !isRampGenerated(r) ||
              r.version === version ||
              r.version === liveVersion,
          )
      : allSorted.filter((r) => {
          if (
            r.status === "discarded" &&
            !showDiscarded &&
            r.version !== version &&
            r.version !== liveVersion
          )
            return false;
          if (
            isRampGenerated(r) &&
            !showGenerated &&
            r.version !== version &&
            r.version !== liveVersion
          )
            return false;
          return true;
        });

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

  const handleSelect = (v: number) => {
    setVersion(v);
    setOpen(false);
  };

  const menuItems = shown.map((r) => (
    <DropdownMenuItem
      key={r.version}
      className={`multiline-item${r.version === version ? " selected-item" : ""}`}
      onClick={() => handleSelect(r.version)}
    >
      <RevisionRow
        r={r}
        liveVersion={liveVersion}
        publishedOnly={publishedOnly}
      />
    </DropdownMenuItem>
  ));

  const discardedCount = allSorted.filter(
    (r) => r.status === "discarded",
  ).length;
  const generatedCount = allSorted.filter(isRampGenerated).length;

  const triggerWidth = context === "header" ? 250 : "100%";

  const trigger = (
    <Flex
      align="center"
      justify="between"
      gap="3"
      style={{ width: triggerWidth, overflow: "hidden" }}
    >
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
      {!publishedOnly && (selectedRevision || !draftsOnly) && (
        <Box flexShrink="0">
          <RevisionStatusBadge
            revision={selectedRevision}
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
      triggerClassName={`dropdown-trigger-select-style${context === "header" ? " dropdown-trigger-header" : ""}`}
      triggerStyle={
        context === "header" ? { paddingTop: 4, paddingBottom: 4 } : undefined
      }
      menuWidth="full"
      menuPlacement={menuPlacement}
    >
      {!publishedOnly && generatedCount > 0 && (
        <RadixDropdownMenu.Label>
          <Flex align="center" gap="2" justify="end" style={{ width: "100%" }}>
            <Text size="small" color="text-low">
              Show ramp-generated ({generatedCount})
            </Text>
            <Switch
              size="1"
              value={showGenerated}
              onChange={setShowGenerated}
            />
          </Flex>
        </RadixDropdownMenu.Label>
      )}
      {!draftsOnly && !publishedOnly && discardedCount > 0 && (
        <RadixDropdownMenu.Label>
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
        </RadixDropdownMenu.Label>
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

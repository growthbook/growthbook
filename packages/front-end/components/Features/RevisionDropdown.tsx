import { ReactNode } from "react";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { dateNoYear } from "shared/dates";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { Flex } from "@radix-ui/themes";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import { DropdownMenuLabel } from "@/ui/DropdownMenu";
import EventUser from "@/components/Avatar/EventUser";
import RevisionStatusBadge, {
  isRampGenerated,
} from "@/components/Reviews/RevisionStatusBadge";
import SharedRevisionDropdown, {
  RevisionDropdownRow,
} from "@/components/Reviews/RevisionDropdown";

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

// Feature wrapper around the shared <RevisionDropdown>: applies the feature's
// filtering modes (drafts-only / published-only / default) + ramp-generated and
// discarded toggles, and renders the feature attribution/date metadata and the
// RevisionStatusBadge. The shared component owns the open/scroll/pagination/menu.
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
    ? withoutLive
        .filter((r) => r.status === "published")
        .filter(
          (r) => showGenerated || !isRampGenerated(r) || r.version === version,
        )
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

  const buildMeta = (r: MinimalFeatureRevisionInterface): ReactNode => {
    const revDate = publishedOnly
      ? (r.datePublished ?? r.dateUpdated)
      : r.status === "published"
        ? r.datePublished
        : r.dateUpdated;
    if (publishedOnly) {
      return revDate ? (
        <Text size="small" color="text-low" whiteSpace="nowrap">
          Published: {dateNoYear(revDate)}
        </Text>
      ) : null;
    }
    return r.createdBy || revDate ? (
      <Text size="small" color="text-low" whiteSpace="nowrap">
        {r.createdBy?.type === "system" ? (
          <em>generated</em>
        ) : r.createdBy ? (
          <EventUser user={r.createdBy} display="name" />
        ) : null}
        {r.createdBy && revDate && <> &middot; </>}
        {revDate && dateNoYear(revDate)}
      </Text>
    ) : null;
  };

  const rows: RevisionDropdownRow[] = displayList.map((r) => ({
    key: String(r.version),
    version: r.version,
    title: r.title,
    meta: buildMeta(r),
    badge: publishedOnly ? undefined : (
      <RevisionStatusBadge revision={r} liveVersion={liveVersion} />
    ),
  }));

  const selectedRevision =
    version !== null
      ? (displayList.find((r) => r.version === version) ??
        allSorted.find((r) => r.version === version))
      : null;

  const discardedCount = allSorted.filter(
    (r) => r.status === "discarded",
  ).length;
  const generatedCount = allSorted.filter(isRampGenerated).length;

  const toggles = (
    <>
      {generatedCount > 0 && (
        <DropdownMenuLabel>
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
        </DropdownMenuLabel>
      )}
      {!draftsOnly && !publishedOnly && discardedCount > 0 && (
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
    </>
  );

  const showTriggerBadge =
    !publishedOnly && (!!selectedRevision || !draftsOnly);

  return (
    <SharedRevisionDropdown
      rows={rows}
      selectedKey={version !== null ? String(version) : null}
      onSelect={(key) => setVersion(Number(key))}
      toggles={toggles}
      selectedBadge={
        showTriggerBadge ? (
          <RevisionStatusBadge
            revision={selectedRevision ?? undefined}
            liveVersion={liveVersion}
          />
        ) : undefined
      }
      triggerNumbered={!!selectedRevision?.title}
      context={context}
      menuPlacement={menuPlacement}
      paginate={!draftsOnly}
      windowFromSelection={!publishedOnly}
    />
  );
}

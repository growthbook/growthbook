import { ReactNode, useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import clsx from "clsx";
import {
  PiArrowRight,
  PiCaretDown,
  PiClockFill,
  PiLockSimple,
  PiPencil,
  PiProhibit,
} from "react-icons/pi";
import { datetime } from "shared/dates";
import {
  isOpenUserDraft,
  isRevisionEditLockedBySchedule,
  isScheduledPublishLockActive,
} from "shared/enterprise";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { MinimalFeatureRevisionInterface } from "shared/validators";
import { canDiscardFeatureDraftControl } from "shared/permissions";
import {
  autoMerge,
  fillRevisionFromFeature,
  filterEnvironmentsByFeature,
  liveRevisionFromFeature,
} from "shared/util";
import {
  featureToFeatureRevisionDiffInput,
  mergeResultToDiffInput,
  revisionToFeatureRevisionDiffInput,
  useFeatureRevisionDiff,
} from "@/hooks/useFeatureRevisionDiff";
import { useFeatureRevisions } from "@/hooks/useFeatureRevisions";
import { useEnvironments } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import DiscardDraftModal from "@/components/Reviews/DiscardDraftModal";
import RevisionStatusBadge from "@/components/Reviews/RevisionStatusBadge";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { getRevisionStatus } from "@/services/revisionStatus";
import styles from "./RevisionStatusBar.module.scss";

// Room for a normal-sized button with even padding. A message that wraps
// grows it.
export const REVISION_STATUS_BAR_HEIGHT_PX = 48;

/**
 * The viewed revision's state, fixed under the page's tabs: what it is, what
 * SDKs serve meanwhile, and what to do next.
 */
export default function RevisionStatusBar({
  baseFeature,
  revision,
  revisionList,
  setTab,
  setVersion,
  mutate,
}: {
  // The live feature.
  baseFeature: FeatureInterface;
  // The one being viewed.
  revision: FeatureRevisionInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  setTab: (tab: "review") => void;
  setVersion: (version: number) => void;
  mutate: () => Promise<unknown>;
}) {
  const { apiCall } = useAuth();
  const { userId } = useUser();
  const permissionsUtil = usePermissionsUtil();
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const liveVersion = baseFeature.version;
  const status = getRevisionStatus({ revision, liveVersion, revisionList });

  // What publishing would change, counted as the review tab lists it: the
  // draft merged onto live, so live's edits since the draft's base don't count
  // as the draft's. The raw draft stands in until both revisions load.
  const isDraft = status === "draft" || status === "scheduled";
  const allEnvironments = useEnvironments();
  const { get: getRevision } = useFeatureRevisions(
    baseFeature.id,
    isDraft ? [revision.baseVersion, liveVersion] : [],
  );
  const baseRevision = getRevision(revision.baseVersion);
  const liveRevision = getRevision(liveVersion);
  const liveInput = useMemo(
    () => featureToFeatureRevisionDiffInput(baseFeature),
    [baseFeature],
  );
  const draftInput = useMemo(() => {
    if (!isDraft) return liveInput;
    if (baseRevision && liveRevision) {
      const merged = autoMerge(
        liveRevisionFromFeature(liveRevision, baseFeature),
        fillRevisionFromFeature(baseRevision, baseFeature),
        revision,
        filterEnvironmentsByFeature(allEnvironments, baseFeature).map(
          (e) => e.id,
        ),
        {},
      );
      if (merged.success)
        return mergeResultToDiffInput(merged.result, liveInput);
    }
    return revisionToFeatureRevisionDiffInput(revision, liveInput);
  }, [
    isDraft,
    baseRevision,
    liveRevision,
    revision,
    baseFeature,
    allEnvironments,
    liveInput,
  ]);
  const changeCount = useFeatureRevisionDiff({
    current: liveInput,
    draft: draftInput,
  }).length;

  if (!status) return null;

  const inReview =
    revision.status === "pending-review" ||
    revision.status === "changes-requested";
  const canDiscard =
    isDraft &&
    canDiscardFeatureDraftControl({
      permissions: permissionsUtil,
      feature: baseFeature,
      draft: revision,
      userId,
    });

  const drafts = revisionList.filter(isOpenUserDraft);
  const switchToLive = (
    <Link onClick={() => setVersion(liveVersion)}>Switch to live</Link>
  );
  // The live revision, named in the message and opened from it.
  const liveRevisionLink = (
    <Link
      underline="always"
      color="inherit"
      onClick={() => setVersion(liveVersion)}
    >
      Revision {liveVersion}
    </Link>
  );

  let icon: ReactNode;
  // Live needs no label: the message says what's pending.
  let label: string | null = null;
  let message: ReactNode;
  let actions: ReactNode = null;
  if (isDraft) {
    actions = (
      <>
        {canDiscard ? (
          <Link onClick={() => setConfirmDiscard(true)}>Discard</Link>
        ) : null}
        <Button
          icon={<PiArrowRight />}
          iconPosition="right"
          onClick={() => setTab("review")}
        >
          Review &amp; publish
        </Button>
      </>
    );
    if (status === "scheduled" && revision.scheduledPublishAt) {
      const editsLocked = isRevisionEditLockedBySchedule(revision);
      const lockClauses = [
        editsLocked ? "edits are locked" : null,
        isScheduledPublishLockActive(revision) &&
        revision.scheduledPublishLockOthers
          ? "publishing other drafts is locked"
          : null,
      ].filter((c): c is string => c !== null);
      icon = lockClauses.length ? <PiLockSimple /> : <PiClockFill />;
      label = editsLocked ? "Draft · locked" : "Draft · scheduled";
      message = (
        <>
          Publishes {datetime(revision.scheduledPublishAt)}
          {inReview ? " once approved" : ""}
          {lockClauses.length ? `; ${lockClauses.join(" and ")}` : ""}.
        </>
      );
    } else {
      icon = <PiPencil />;
      label = "Draft · not live";
      message = (
        <>
          {changeCount
            ? `${changeCount} unpublished change${changeCount === 1 ? "" : "s"}.`
            : "No changes yet."}{" "}
          SDKs keep serving {liveRevisionLink} until you publish.
        </>
      );
    }
  } else if (status === "discarded") {
    icon = <PiProhibit />;
    label = "Discarded";
    message = "This revision was never published.";
    actions = switchToLive;
  } else if (status === "held") {
    icon = <PiClockFill />;
    label = "Held · not live";
    message = (
      <>Its ramp schedule will publish it. SDKs serve {liveRevisionLink}.</>
    );
    actions = switchToLive;
  } else if (status === "superseded") {
    icon = <PiLockSimple />;
    label = "Published · not live";
    message = <>SDKs serve {liveRevisionLink}.</>;
    actions = switchToLive;
  } else {
    icon = <PiPencil />;
    message =
      drafts.length === 1
        ? "This Feature Flag has a draft."
        : `This Feature Flag has ${drafts.length} drafts.`;
    actions =
      drafts.length === 1 ? (
        <Link onClick={() => setVersion(drafts[0].version)}>
          Switch to draft
        </Link>
      ) : (
        <DropdownMenu
          variant="soft"
          menuPlacement="end"
          trigger={
            <Link>
              <Flex align="center" gap="1">
                Switch to draft
                <PiCaretDown />
              </Flex>
            </Link>
          }
        >
          {drafts.map((d) => (
            <DropdownMenuItem
              key={d.version}
              onClick={() => setVersion(d.version)}
            >
              <Flex align="center" justify="between" gap="4" width="100%">
                <Text truncate>
                  Revision {d.version}
                  {d.title ? ` · ${d.title}` : ""}
                </Text>
                <RevisionStatusBadge revision={d} liveVersion={liveVersion} />
              </Flex>
            </DropdownMenuItem>
          ))}
        </DropdownMenu>
      );
  }

  const tint = isDraft ? "amber" : "gray";

  return (
    <>
      <div
        className={styles.bar}
        style={{
          backgroundColor: `var(--${tint}-a3)`,
          // The tab row's underline, above it.
          boxShadow: "inset 0 1px 0 0 var(--gray-a5)",
        }}
      >
        <div
          // The header's page column, so the two line up.
          className={clsx("container-fluid pagecontents", styles.row)}
          style={{
            // Inset as the cards' content is below: the page gutter, a card's
            // padding, and a border as wide as the card's, which zoom rounds
            // the same way. Its actions end under the revision picker.
            paddingInline: "calc(2 * var(--space-5))",
            borderInline: "1px solid transparent",
            paddingBlock: "var(--space-2)",
            minHeight: REVISION_STATUS_BAR_HEIGHT_PX,
          }}
        >
          <Flex className={styles.status} align="center" gap="3">
            <Flex
              align="center"
              gap="1"
              flexShrink="0"
              style={{ color: `var(--${tint}-11)` }}
            >
              {icon}
              {label ? <Text weight="semibold">{label}</Text> : null}
            </Flex>
            {/* Where the draft is in review, beside what it is. */}
            {isDraft && revision.status !== "draft" ? (
              <Flex flexShrink="0">
                <RevisionStatusBadge
                  revision={revision}
                  liveVersion={liveVersion}
                />
              </Flex>
            ) : null}
          </Flex>
          <div className={styles.message}>
            <Text color="text-mid">{message}</Text>
          </div>
          {actions ? (
            <Flex className={styles.actions} align="center" gap="4">
              {actions}
            </Flex>
          ) : null}
        </div>
      </div>
      {confirmDiscard ? (
        <DiscardDraftModal
          trackingEventModalType="discard-feature-revision"
          close={() => setConfirmDiscard(false)}
          discard={async () => {
            try {
              await apiCall(
                `/feature/${baseFeature.id}/${revision.version}/discard`,
                { method: "POST" },
              );
              setVersion(liveVersion);
            } finally {
              await mutate();
            }
          }}
        />
      ) : null}
    </>
  );
}

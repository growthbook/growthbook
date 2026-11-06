import { ReactNode, useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { FaArrowRight } from "react-icons/fa";
import {
  PiCaretDown,
  PiClockFill,
  PiLockSimple,
  PiPencil,
  PiProhibit,
} from "react-icons/pi";
import { datetime } from "shared/dates";
import {
  isRevisionEditLockedBySchedule,
  isScheduledPublishLockActive,
  isScheduledPublishPending,
} from "shared/enterprise";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import {
  ACTIVE_DRAFT_STATUSES,
  MinimalFeatureRevisionInterface,
  eventUserPersonId,
} from "shared/validators";
import {
  featureToFeatureRevisionDiffInput,
  revisionToFeatureRevisionDiffInput,
  useFeatureRevisionDiff,
} from "@/hooks/useFeatureRevisionDiff";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import DiscardDraftModal from "@/components/Reviews/DiscardDraftModal";
import RevisionStatusBadge, {
  isRampGenerated,
} from "@/components/Reviews/RevisionStatusBadge";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

// Room for a normal-sized button with even padding.
export const REVISION_STATUS_BAR_HEIGHT_PX = 48;

type RevisionStatus =
  | "draft"
  | "scheduled"
  | "discarded"
  | "superseded"
  | "liveWithDrafts";

function activeDrafts(revisionList: MinimalFeatureRevisionInterface[]) {
  return revisionList.filter(
    (r) =>
      !isRampGenerated(r) &&
      (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
  );
}

/** What the strip under the tabs says about the viewed revision, if anything. */
export function getRevisionStatus({
  revision,
  liveVersion,
  revisionList,
}: {
  revision: FeatureRevisionInterface;
  liveVersion: number;
  revisionList: MinimalFeatureRevisionInterface[];
}): RevisionStatus | null {
  if ((ACTIVE_DRAFT_STATUSES as readonly string[]).includes(revision.status)) {
    return isScheduledPublishPending(revision) ? "scheduled" : "draft";
  }
  if (revision.status === "discarded") return "discarded";
  if (revision.version !== liveVersion) return "superseded";
  return activeDrafts(revisionList).length > 0 ? "liveWithDrafts" : null;
}

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

  // What publishing would change, counted as the review tab lists it.
  const liveInput = useMemo(
    () => featureToFeatureRevisionDiffInput(baseFeature),
    [baseFeature],
  );
  const draftInput = useMemo(
    () =>
      status === "draft" || status === "scheduled"
        ? revisionToFeatureRevisionDiffInput(revision, liveInput)
        : liveInput,
    [status, revision, liveInput],
  );
  const changeCount = useFeatureRevisionDiff({
    current: liveInput,
    draft: draftInput,
  }).length;

  if (!status) return null;

  const isDraft = status === "draft" || status === "scheduled";
  const inReview =
    revision.status === "pending-review" ||
    revision.status === "changes-requested";
  const authoredDraft =
    !!userId &&
    (eventUserPersonId(revision.createdBy ?? null) === userId ||
      (revision.contributors ?? []).includes(userId));
  const canDiscard =
    isDraft &&
    (permissionsUtil.canEditFeatureDrafts(baseFeature) || authoredDraft);

  const drafts = activeDrafts(revisionList);
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
          icon={<FaArrowRight />}
          iconPosition="right"
          onClick={() => setTab("review")}
        >
          Review &amp; publish
        </Button>
      </>
    );
    if (status === "scheduled") {
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
          Publishes {datetime(revision.scheduledPublishAt as Date)}
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
  } else if (status === "superseded") {
    icon = <PiLockSimple />;
    label = "Published · not live";
    message = <>SDKs serve {liveRevisionLink}.</>;
    actions = switchToLive;
  } else {
    icon = <PiPencil />;
    message =
      drafts.length === 1
        ? "This feature has a draft."
        : `This feature has ${drafts.length} drafts.`;
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
        style={{
          height: REVISION_STATUS_BAR_HEIGHT_PX,
          backgroundColor: `var(--${tint}-a3)`,
          // The tab row's underline, above it.
          boxShadow: "inset 0 1px 0 0 var(--gray-a5)",
        }}
      >
        <Flex
          className="container-fluid pagecontents px-4"
          align="center"
          justify="between"
          gap="4"
          height="100%"
        >
          <Flex align="center" gap="3" minWidth="0">
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
            <Text color="text-mid" truncate>
              {message}
            </Text>
          </Flex>
          {actions ? (
            <Flex align="center" gap="4" flexShrink="0">
              {actions}
            </Flex>
          ) : null}
        </Flex>
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
            } finally {
              await mutate();
            }
          }}
        />
      ) : null}
    </>
  );
}

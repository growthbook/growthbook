import { ReactNode, useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
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
import RevisionStatusBarView from "@/components/Reviews/RevisionStatusBarView";

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
  const { t } = useLingui();
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
    <Link onClick={() => setVersion(liveVersion)}>
      <Trans>Switch to live</Trans>
    </Link>
  );
  // The live revision, named in the message and opened from it.
  const liveRevisionLink = (
    <Link
      underline="always"
      color="inherit"
      onClick={() => setVersion(liveVersion)}
    >
      <Trans>Revision {liveVersion}</Trans>
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
          <Link onClick={() => setConfirmDiscard(true)}>
            <Trans>Discard</Trans>
          </Link>
        ) : null}
        <Button
          icon={<PiArrowRight />}
          iconPosition="right"
          onClick={() => setTab("review")}
        >
          <Trans>Review &amp; publish</Trans>
        </Button>
      </>
    );
    if (status === "scheduled" && revision.scheduledPublishAt) {
      const editsLocked = isRevisionEditLockedBySchedule(revision);
      const othersLocked =
        isScheduledPublishLockActive(revision) &&
        !!revision.scheduledPublishLockOthers;
      icon = editsLocked || othersLocked ? <PiLockSimple /> : <PiClockFill />;
      label = editsLocked ? t`Draft · locked` : t`Draft · scheduled`;
      const when = datetime(revision.scheduledPublishAt);
      message = inReview
        ? editsLocked && othersLocked
          ? t`Publishes ${when} once approved; edits are locked and publishing other drafts is locked.`
          : editsLocked
            ? t`Publishes ${when} once approved; edits are locked.`
            : othersLocked
              ? t`Publishes ${when} once approved; publishing other drafts is locked.`
              : t`Publishes ${when} once approved.`
        : editsLocked && othersLocked
          ? t`Publishes ${when}; edits are locked and publishing other drafts is locked.`
          : editsLocked
            ? t`Publishes ${when}; edits are locked.`
            : othersLocked
              ? t`Publishes ${when}; publishing other drafts is locked.`
              : t`Publishes ${when}.`;
    } else {
      icon = <PiPencil />;
      label = t`Draft · not live`;
      message = (
        <>
          {changeCount ? (
            <Plural
              value={changeCount}
              one="# unpublished change."
              other="# unpublished changes."
            />
          ) : (
            <Trans>No changes yet.</Trans>
          )}{" "}
          <Trans>SDKs keep serving {liveRevisionLink} until you publish.</Trans>
        </>
      );
    }
  } else if (status === "discarded") {
    icon = <PiProhibit />;
    label = t`Discarded`;
    message = t`This revision was never published.`;
    actions = switchToLive;
  } else if (status === "held") {
    icon = <PiClockFill />;
    label = t`Held · not live`;
    message = (
      <Trans>
        Its ramp schedule will publish it. SDKs serve {liveRevisionLink}.
      </Trans>
    );
    actions = switchToLive;
  } else if (status === "superseded") {
    icon = <PiLockSimple />;
    label = t`Published · not live`;
    message = <Trans>SDKs serve {liveRevisionLink}.</Trans>;
    actions = switchToLive;
  } else {
    icon = <PiPencil />;
    const draftCount = drafts.length;
    message =
      draftCount === 1
        ? t`This Feature Flag has a draft.`
        : t`This Feature Flag has ${draftCount} drafts.`;
    actions =
      drafts.length === 1 ? (
        <Link onClick={() => setVersion(drafts[0].version)}>
          <Trans>Switch to draft</Trans>
        </Link>
      ) : (
        <DropdownMenu
          variant="soft"
          menuPlacement="end"
          trigger={
            <Link>
              <Flex align="center" gap="1">
                <Trans>Switch to draft</Trans>
                <PiCaretDown />
              </Flex>
            </Link>
          }
        >
          {drafts.map((d) => {
            const draftVersion = d.version;
            return (
              <DropdownMenuItem
                key={d.version}
                onClick={() => setVersion(d.version)}
              >
                <Flex align="center" justify="between" gap="4" width="100%">
                  <Text truncate>
                    <Trans>Revision {draftVersion}</Trans>
                    {d.title ? ` · ${d.title}` : ""}
                  </Text>
                  <RevisionStatusBadge revision={d} liveVersion={liveVersion} />
                </Flex>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenu>
      );
  }

  return (
    <>
      <RevisionStatusBarView
        draft={isDraft}
        icon={icon}
        label={label}
        badge={
          isDraft && revision.status !== "draft" ? (
            <RevisionStatusBadge
              revision={revision}
              liveVersion={liveVersion}
            />
          ) : null
        }
        message={message}
        actions={actions}
      />
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

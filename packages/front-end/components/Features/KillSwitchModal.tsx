import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiToggleLeft, PiToggleRight } from "react-icons/pi";
import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import { getReviewSetting, getDraftAffectedEnvironments } from "shared/util";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Modal from "@/components/Modal";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useEnvironments } from "@/services/features";
import track from "@/services/track";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import DraftSelectorForChanges from "@/components/Features/DraftSelectorForChanges";

function ToggleIcon({ enabled, muted }: { enabled: boolean; muted: boolean }) {
  const Icon = enabled ? PiToggleRight : PiToggleLeft;
  return (
    <Icon
      size={24}
      style={{
        color: muted
          ? "var(--gray-6)"
          : enabled
            ? "var(--green-9)"
            : "var(--red-9)",
        flexShrink: 0,
      }}
    />
  );
}

function EnvStateGrid({
  liveFeature,
  draftFeature,
  allOrgEnvironments,
  changedEnv,
  desiredState,
  liveVersion,
  afterChangeSubtext,
}: {
  /** Pure live document — used for the "Live" row. */
  liveFeature: FeatureInterface;
  /** Draft-merged document — used as the base for the "After change" row. */
  draftFeature: FeatureInterface;
  allOrgEnvironments: Environment[];
  changedEnv: string;
  desiredState: boolean;
  liveVersion: number;
  afterChangeSubtext: string;
}) {
  const COL_W = 70;
  const LABEL_W = 156;
  const ROW_PY = 6;

  // liveFeature.environmentSettings is filtered server-side to only environments
  // relevant to this feature's project — use that as the source of truth for
  // which environments to display, ordered by the org environment list.
  const liveEnvSettings = liveFeature.environmentSettings ?? {};
  const draftEnvSettings = draftFeature.environmentSettings ?? {};
  const visibleEnvs = allOrgEnvironments.filter(
    (env) => env.id in liveEnvSettings,
  );

  return (
    <Box
      my="4"
      style={{ overflowX: "auto" }}
    >
      <Flex direction="column" style={{ minWidth: "max-content" }}>
        {/* Header row */}
        <Flex
          align="center"
          pb="2"
          style={{ borderBottom: "1px solid var(--gray-4)" }}
        >
          <Box style={{ width: LABEL_W, flexShrink: 0 }} />
          {visibleEnvs.map((env) => (
            <Box
              key={env.id}
              style={{
                width: COL_W,
                flexShrink: 0,
                textAlign: "center",
                opacity: env.id === changedEnv ? 1 : 0.4,
              }}
            >
              <Text size="small" weight="semibold" color="text-mid">
                <OverflowText maxWidth={COL_W}>{env.id}</OverflowText>
              </Text>
            </Box>
          ))}
        </Flex>

        {/* Live row */}
        <Flex
          align="center"
          style={{ paddingTop: ROW_PY, paddingBottom: ROW_PY }}
        >
          <Box style={{ width: LABEL_W, flexShrink: 0 }}>
            <Text size="small" weight="semibold">
              Live
            </Text>
            <div style={{ fontSize: "0.75em", color: "var(--color-text-low)" }}>
              revision {liveVersion}
            </div>
          </Box>
          {visibleEnvs.map((env) => {
            const enabled = liveEnvSettings[env.id]?.enabled ?? false;
            const isChanged = env.id === changedEnv;
            return (
              <Flex
                key={env.id}
                justify="center"
                align="center"
                style={{ width: COL_W, flexShrink: 0 }}
              >
                <ToggleIcon enabled={enabled} muted={!isChanged} />
              </Flex>
            );
          })}
        </Flex>

        {/* After-change row */}
        <Flex
          align="center"
          style={{ paddingTop: ROW_PY, paddingBottom: ROW_PY }}
        >
          <Box style={{ width: LABEL_W, flexShrink: 0 }}>
            <Text size="small" weight="semibold">
              After change
            </Text>
            <div style={{ fontSize: "0.75em", color: "var(--color-text-low)" }}>
              {afterChangeSubtext}
            </div>
          </Box>
          {visibleEnvs.map((env) => {
            const enabled =
              env.id === changedEnv
                ? desiredState
                : (draftEnvSettings[env.id]?.enabled ?? false);
            const isChanged = env.id === changedEnv;
            return (
              <Flex
                key={env.id}
                justify="center"
                align="center"
                style={{ width: COL_W, flexShrink: 0 }}
              >
                <ToggleIcon enabled={enabled} muted={!isChanged} />
              </Flex>
            );
          })}
        </Flex>
      </Flex>
    </Box>
  );
}

export interface KillSwitchModalProps {
  /** Merged feature (may reflect draft state) — used for toggle preselection. */
  feature: FeatureInterface;
  /** Live base feature document — used for the live-state row in the grid. */
  baseFeature?: FeatureInterface;
  environment: string;
  /** The desired new state (true = enable, false = disable). */
  desiredState: boolean;
  /** Revision currently being viewed — pre-selected in the draft dropdown. */
  currentVersion: number;
  revisionList: MinimalFeatureRevisionInterface[];
  /** Full revision objects for computing affected environments per draft. */
  allRevisions?: FeatureRevisionInterface[];
  mutate: () => Promise<unknown>;
  setVersion: (version: number) => void;
  close: () => void;
}

export default function KillSwitchModal({
  feature,
  baseFeature,
  environment,
  desiredState,
  currentVersion,
  revisionList,
  allRevisions,
  mutate,
  setVersion,
  close,
}: KillSwitchModalProps) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const settings = useOrgSettings();
  const { organization } = useUser();
  const allOrgEnvironments = useEnvironments();

  const isAdmin = permissionsUtil.canBypassApprovalChecks(feature);

  // Determine per-environment approval gating.
  // requireReviews === true is the top-level opt-in (all envs gated);
  // the array format allows per-project/env configuration.
  const rawRequireReviews = settings?.requireReviews;

  // Badge display: reflects env filtering only (no kill-switch-specific checks).
  // "all" if no env list, a Set if specific envs are listed, "none" if approvals off.
  const gatedEnvSet: Set<string> | "all" | "none" = (() => {
    if (rawRequireReviews === true) return "all";
    if (!Array.isArray(rawRequireReviews)) return "none";
    const reviewSetting = getReviewSetting(rawRequireReviews, feature);
    if (!reviewSetting?.requireReviewOn) return "none";
    const gatedEnvs = reviewSetting.environments ?? [];
    return gatedEnvs.length === 0 ? "all" : new Set(gatedEnvs);
  })();

  // Approval requirement for this specific kill-switch action: also checks
  // featureRequireEnvironmentReview, which can disable kill-switch gating.
  const envIsGated: boolean = (() => {
    if (rawRequireReviews === true) return true;
    if (!Array.isArray(rawRequireReviews)) return false;
    const reviewSetting = getReviewSetting(rawRequireReviews, feature);
    if (!reviewSetting?.requireReviewOn) return false;
    if (reviewSetting.featureRequireEnvironmentReview === false) return false;
    const gatedEnvs = reviewSetting.environments ?? [];
    return gatedEnvs.length === 0 || gatedEnvs.includes(environment);
  })();

  // Admins can always auto-publish. Non-admins can only auto-publish if not gated.
  const canAutoPublish = isAdmin || !envIsGated;

  // Active drafts for the dropdown
  const activeDrafts = useMemo(
    () =>
      revisionList.filter((r) =>
        (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
      ),
    [revisionList],
  );

  // Compute affected environments per draft version for badge display
  const affectedEnvsByVersion = useMemo(() => {
    if (!allRevisions || allRevisions.length === 0) return undefined;
    const allEnvIds = allOrgEnvironments.map((e) => e.id);
    const revisionsMap = new Map(allRevisions.map((r) => [r.version, r]));
    const baseRevision = revisionsMap.get(feature.version);
    if (!baseRevision) return undefined;
    const map = new Map<number, string[] | "all">();
    for (const draft of activeDrafts) {
      const full = revisionsMap.get(draft.version);
      if (full) {
        map.set(
          draft.version,
          getDraftAffectedEnvironments(full, baseRevision, allEnvIds),
        );
      }
    }
    return map;
  }, [allRevisions, activeDrafts, feature.version, allOrgEnvironments]);

  // Whether we're already viewing an active draft
  const viewingActiveDraft = activeDrafts.some(
    (r) => r.version === currentVersion,
  );

  // Pre-check auto-publish only when not already on a draft and we have permission.
  // If on a draft: pre-select that draft instead.
  // If not on a draft and cannot auto-publish: pre-select the most recent draft (or null).
  const [autoPublish, setAutoPublish] = useState(
    !viewingActiveDraft && canAutoPublish,
  );

  // Pre-select: currentVersion if it's an active draft, else newest owned by
  // the current user, else newest overall, else null (= new draft).
  const userId = organization?.ownerEmail;
  const defaultDraft = useMemo((): number | null => {
    if (activeDrafts.find((r) => r.version === currentVersion)) {
      return currentVersion;
    }
    const byMe = activeDrafts.find(
      (r) =>
        r.createdBy &&
        "id" in r.createdBy &&
        (r.createdBy as { id?: string }).id === userId,
    );
    if (byMe) return byMe.version;
    if (activeDrafts.length > 0) return activeDrafts[0].version;
    return null;
  }, [activeDrafts, currentVersion, userId]);

  // null = "New Draft" sentinel
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  // When autoPublish is on, show "New Draft" in the selector;
  // toggling it off restores the previous selection.
  const displayedDraft = autoPublish ? null : selectedDraft;

  const submit = async () => {
    if (autoPublish) {
      const res = await apiCall<{ status: 200; draftVersion?: number }>(
        `/feature/${feature.id}/toggle`,
        {
          method: "POST",
          body: JSON.stringify({
            environment,
            state: desiredState,
            autoPublish: true,
          }),
        },
      );
      track("Feature Environment Toggle", {
        environment,
        enabled: desiredState,
        autoPublish: true,
      });
      await mutate();
      if (res?.draftVersion) setVersion(res.draftVersion);
    } else {
      const res = await apiCall<{ status: 200; draftVersion?: number }>(
        `/feature/${feature.id}/toggle`,
        {
          method: "POST",
          body: JSON.stringify({
            environment,
            state: desiredState,
            // null selectedDraft = create a brand-new draft
            ...(selectedDraft != null
              ? { draftVersion: selectedDraft }
              : { forceNewDraft: true }),
          }),
        },
      );
      track("Feature Environment Toggle", {
        environment,
        enabled: desiredState,
        autoPublish: false,
      });
      await mutate();
      if (res?.draftVersion) setVersion(res.draftVersion);
    }
  };

  const actionLabel = desiredState ? "Enable" : "Disable";

  return (
    <Modal
      trackingEventModalType="kill-switch-toggle"
      header={`${actionLabel} ${environment}`}
      close={close}
      open={true}
      cta={autoPublish ? `${actionLabel} now` : "Save to draft"}
      submit={submit}
      useRadixButton={true}
    >
      <DraftSelectorForChanges
        feature={feature}
        revisionList={revisionList}
        autoPublish={autoPublish}
        setAutoPublish={setAutoPublish}
        selectedDraft={selectedDraft}
        setSelectedDraft={setSelectedDraft}
        canAutoPublish={canAutoPublish}
        gatedEnvSet={gatedEnvSet}
        affectedEnvs={(() => {
          if (autoPublish || displayedDraft === null) return null;
          const affected = affectedEnvsByVersion?.get(displayedDraft);
          if (!affected || (Array.isArray(affected) && affected.length === 0))
            return null;
          return affected;
        })()}
      />

      <Text as="p" mb="2">
        You are about to set the <strong>{environment}</strong> environment to{" "}
        <strong
          style={{ color: desiredState ? "var(--green-9)" : "var(--red-9)" }}
        >
          {desiredState ? "enabled" : "disabled"}
        </strong>
        .
      </Text>
      <EnvStateGrid
        liveFeature={baseFeature ?? feature}
        draftFeature={
          // Use the current draft's merged state only when we're actually
          // applying the toggle on top of that specific draft. For "new draft"
          // or any other existing draft we don't have merged state for, fall
          // back to live so the grid shows only the proposed toggle change.
          displayedDraft === currentVersion ? feature : (baseFeature ?? feature)
        }
        allOrgEnvironments={allOrgEnvironments}
        changedEnv={environment}
        desiredState={desiredState}
        liveVersion={(baseFeature ?? feature).version}
        afterChangeSubtext={
          displayedDraft != null
            ? `revision ${displayedDraft}`
            : autoPublish
              ? "new revision"
              : "new draft"
        }
      />
    </Modal>
  );
}

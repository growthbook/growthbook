import { useEffect, useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { isActiveDraftStatus, eventUserPersonId } from "shared/validators";
import {
  getReviewSetting,
  liveRevisionFromFeature,
  buildEffectiveDraft,
  filterEnvironmentsByFeature,
} from "shared/util";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useEnvironments } from "@/services/features";
import track from "@/services/track";
import { useFeatureRevisions } from "@/hooks/useFeatureRevisions";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import PermissionBlocker from "@/ui/PermissionBlocker";

export interface KillSwitchModalProps {
  // Merged feature (may reflect draft state)
  feature: FeatureInterface;
  // Raw live feature document (un-merged)
  baseFeature: FeatureInterface;
  // The environment a switch was flipped for, and the state it asks for.
  environment: string;
  desiredState: boolean;
  currentVersion: number;
  revisionList: MinimalFeatureRevisionInterface[];
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
  mutate,
  setVersion,
  close,
}: KillSwitchModalProps) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const settings = useOrgSettings();
  const { userId } = useUser();
  const allOrgEnvironments = useEnvironments();

  const liveDoc = baseFeature;
  const isAdmin = permissionsUtil.canBypassFlagApprovalChecks(
    liveDoc,
    "feature",
  );

  const rawRequireReviews = settings?.requireReviews;
  const reviewSetting = Array.isArray(rawRequireReviews)
    ? getReviewSetting(rawRequireReviews, feature)
    : null;

  const activeDrafts = useMemo(
    () => revisionList.filter((r) => isActiveDraftStatus(r.status)),
    [revisionList],
  );

  const viewingActiveDraft = activeDrafts.some(
    (r) => r.version === currentVersion,
  );

  const defaultDraft = useMemo((): number | null => {
    if (activeDrafts.find((r) => r.version === currentVersion))
      return currentVersion;
    const byMe = activeDrafts.find(
      (r) => eventUserPersonId(r.createdBy ?? null) === userId,
    );
    if (byMe) return byMe.version;
    return activeDrafts[0]?.version ?? null;
  }, [activeDrafts, currentVersion, userId]);

  const canDraft = permissionsUtil.canEditFeatureDrafts(liveDoc);
  let defaultMode: DraftMode = "new";
  if (!canDraft) defaultMode = "publish";
  else if (viewingActiveDraft) defaultMode = "existing";
  const [mode, setMode] = useState<DraftMode>(defaultMode);
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  const targetRevisions = useFeatureRevisions(feature.id, [
    feature.version,
    mode === "existing" ? selectedDraft : null,
  ]);

  const visibleEnvs = useMemo(
    () => filterEnvironmentsByFeature(allOrgEnvironments, liveDoc),
    [allOrgEnvironments, liveDoc],
  );

  // Base enabled state per env: live (filled) for new/publish, effective draft for existing.
  const baseEnvEnabled = useMemo<Record<string, boolean>>(() => {
    const liveRevision = targetRevisions.get(feature.version);
    if (liveRevision) {
      const filledLive = liveRevisionFromFeature(liveRevision, liveDoc);
      if (mode === "existing" && selectedDraft !== null) {
        const draftRevision = targetRevisions.get(selectedDraft);
        if (draftRevision) {
          return (
            buildEffectiveDraft(draftRevision, filledLive)
              .environmentsEnabled ?? {}
          );
        }
      }
      return filledLive.environmentsEnabled ?? {};
    }
    // Fallback before revisions load
    return Object.fromEntries(
      Object.entries(liveDoc.environmentSettings ?? {}).map(([env, val]) => [
        env,
        !!val.enabled,
      ]),
    );
  }, [targetRevisions, liveDoc, feature.version, mode, selectedDraft]);

  const getEffectiveState = (envId: string): boolean => {
    if (envId === environment) return desiredState;
    return baseEnvEnabled[envId] ?? false;
  };

  // Environments gated by kill-switch approval policy.
  const gatedEnvSet: Set<string> | "all" | "none" = (() => {
    if (rawRequireReviews === true) return "all";
    if (!reviewSetting?.requireReviewOn) return "none";
    if (reviewSetting.featureRequireEnvironmentReview === false) return "none";
    const gatedEnvs = reviewSetting.environments ?? [];
    return gatedEnvs.length === 0 ? "all" : new Set(gatedEnvs);
  })();

  const liveEnvSettings = liveDoc.environmentSettings ?? {};
  const envIsGated =
    gatedEnvSet !== "none" &&
    visibleEnvs.some((env) => {
      const isGated = gatedEnvSet === "all" || gatedEnvSet.has(env.id);
      if (!isGated) return false;
      return getEffectiveState(env.id) !== !!liveEnvSettings[env.id]?.enabled;
    });

  const canPublishFlippedEnvs = visibleEnvs.every(
    (env) =>
      getEffectiveState(env.id) === !!liveEnvSettings[env.id]?.enabled ||
      permissionsUtil.canPublishFeature(liveDoc, [env.id]),
  );

  // Require at least one visible environment the user may publish.
  const canPublishAnyVisibleEnv = visibleEnvs.some((env) =>
    permissionsUtil.canPublishFeature(liveDoc, [env.id]),
  );
  const canAutoPublish =
    (isAdmin || !envIsGated) &&
    canPublishFlippedEnvs &&
    canPublishAnyVisibleEnv;
  const noRouteAvailable = !canDraft && !canAutoPublish;

  useEffect(() => {
    if (!canAutoPublish && canDraft && mode === "publish") {
      setMode("new");
    }
  }, [canAutoPublish, canDraft, mode]);

  const submit = async () => {
    const environments: Record<string, boolean> = {};
    for (const env of visibleEnvs) {
      const effective = getEffectiveState(env.id);
      if (effective !== (baseEnvEnabled[env.id] ?? false)) {
        environments[env.id] = effective;
      }
    }

    if (Object.keys(environments).length === 0) return;

    const modePayload =
      mode === "publish"
        ? { autoPublish: true }
        : mode === "existing"
          ? { draftVersion: selectedDraft }
          : { forceNewDraft: true };

    // A single switch can't conflict, so no baseline is sent: whoever flipped
    // it first flipped it the same way.
    const res = await apiCall<{ status: 200; draftVersion?: number }>(
      `/feature/${feature.id}/toggle`,
      {
        method: "POST",
        body: JSON.stringify({ environments, ...modePayload }),
      },
    );

    track("Feature Environment Toggle", {
      environments,
      autoPublish: mode === "publish",
    });

    await mutate();
    const finalVersion =
      res?.draftVersion ?? (mode === "existing" ? selectedDraft : null);
    if (finalVersion !== null) setVersion(finalVersion);
  };

  const noNetChange = visibleEnvs.every(
    (env) =>
      getEffectiveState(env.id) ===
      (liveDoc.environmentSettings?.[env.id]?.enabled ?? false),
  );

  // True only when the selected draft itself had changes vs live before the user touched anything.
  const draftHadPendingChanges =
    mode === "existing" &&
    visibleEnvs.some(
      (env) =>
        (baseEnvEnabled[env.id] ?? false) !==
        !!liveDoc.environmentSettings?.[env.id]?.enabled,
    );

  // Selected "Publish now" but the flip set includes an environment this user
  // can't publish. The switch was legitimately theirs to flip; the route isn't.
  const cannotLandSelectedRoute =
    mode === "publish" && !noRouteAvailable && !canAutoPublish;
  // Named for the switch that was flipped, whatever else the draft changes.
  const modalHeader = `${getEffectiveState(environment) ? "Enable" : "Disable"} ${environment}`;

  return (
    <ModalStandard
      trackingEventModalType="kill-switch-toggle"
      header={modalHeader}
      close={close}
      open={true}
      cta={mode === "publish" ? "Publish now" : "Save to draft"}
      size="md"
      // Without draft rights, publishing is the only route — and an
      // approval-gated change closes it, leaving nothing to submit.
      submit={noRouteAvailable ? undefined : submit}
      // The switches are open to anyone with either route, so the CTA is where
      // the chosen route is enforced: publishing environments this user can't
      // publish is refused here rather than by the server.
      ctaEnabled={!cannotLandSelectedRoute && !targetRevisions.loading}
    >
      <div>
        {cannotLandSelectedRoute ? (
          <PermissionBlocker mb="4">
            You don&apos;t have permission to publish every environment you
            changed. Save it to a draft instead.
          </PermissionBlocker>
        ) : null}
        {noRouteAvailable ? (
          <PermissionBlocker mb="4">
            This change needs review before it can be published, and you
            don&apos;t have permission to put it in a draft.
          </PermissionBlocker>
        ) : null}
        <DraftSelectorForChanges
          feature={feature}
          baseFeature={baseFeature}
          revisionList={revisionList}
          mode={mode}
          setMode={setMode}
          selectedDraft={selectedDraft}
          setSelectedDraft={setSelectedDraft}
          canAutoPublish={canAutoPublish}
          canDraft={canDraft}
          gatedEnvSet={envIsGated ? gatedEnvSet : "none"}
          defaultExpanded
        />

        <Flex justify="center" mt="2">
          {noNetChange && (
            <Text as="p" color="text-low">
              <em>
                {draftHadPendingChanges
                  ? "This undoes pending draft changes — no net change from live."
                  : mode === "publish"
                    ? "Already matches live — nothing will be published."
                    : "Already matches live — this will have no effect."}
              </em>
            </Text>
          )}
        </Flex>
      </div>
    </ModalStandard>
  );
}

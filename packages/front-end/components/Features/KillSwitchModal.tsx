import { useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { FaCircleCheck, FaCircleXmark } from "react-icons/fa6";
import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import { ACTIVE_DRAFT_STATUSES } from "shared/validators";
import {
  getReviewSetting,
  liveRevisionFromFeature,
  buildEffectiveDraft,
  filterEnvironmentsByFeature,
} from "shared/util";
import Switch from "@/ui/Switch";
import Text from "@/ui/Text";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Modal from "@/components/Modal";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useEnvironments } from "@/services/features";
import track from "@/services/track";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import useApi from "@/hooks/useApi";
import { useFeatureRevisionsContext } from "@/contexts/FeatureRevisionsContext";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";

function EnvStateIcon({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <FaCircleCheck size={20} style={{ color: "var(--green-10)" }} />
  ) : (
    <FaCircleXmark size={20} style={{ color: "var(--color-text-low)" }} />
  );
}

function EnvStateGrid({
  liveFeature,
  visibleEnvs,
  getEffectiveState,
  onToggle,
  canToggle,
  liveVersion,
  afterChangeSubtext,
}: {
  liveFeature: FeatureInterface;
  visibleEnvs: Environment[];
  getEffectiveState: (envId: string) => boolean;
  onToggle: (envId: string, val: boolean) => void;
  canToggle: (envId: string) => boolean;
  liveVersion: number;
  afterChangeSubtext: string;
}) {
  const COL_W = 100;
  const LABEL_W = 140;

  const liveEnvSettings = liveFeature.environmentSettings ?? {};

  return (
    <Box my="4" pb="4" style={{ overflowX: "auto" }}>
      <Flex direction="column" style={{ minWidth: "max-content" }}>
        {/* Env name header — outside the outlined area */}
        <Flex align="center" pb="2">
          <Box style={{ width: LABEL_W, flexShrink: 0 }} />
          {visibleEnvs.map((env) => (
            <Box
              key={env.id}
              style={{ width: COL_W, flexShrink: 0, textAlign: "center" }}
            >
              <Text size="small" weight="semibold" color="text-mid">
                <OverflowText maxWidth={COL_W}>{env.id}</OverflowText>
              </Text>
            </Box>
          ))}
        </Flex>

        {/* Three data rows wrapped in a relative container so outlines can span all of them */}
        <Box style={{ position: "relative" }}>
          {/* Per-column touched outlines */}
          {visibleEnvs.map((env, i) =>
            (liveEnvSettings[env.id]?.enabled ?? false) !==
            getEffectiveState(env.id) ? (
              <div
                key={env.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: LABEL_W + i * COL_W + 6,
                  width: COL_W - 12,
                  height: "100%",
                  borderRadius: "var(--radius-3)",
                  boxShadow: "inset 0 0 0 1.5px var(--violet-7)",
                  pointerEvents: "none",
                }}
              />
            ) : null,
          )}

          {/* Change State / switches row */}
          <Flex
            align="center"
            py="3"
            style={{ borderBottom: "1px solid var(--gray-4)" }}
          >
            <Box style={{ width: LABEL_W, flexShrink: 0 }} />
            {visibleEnvs.map((env) => (
              <Flex
                key={env.id}
                justify="center"
                align="center"
                style={{ width: COL_W, flexShrink: 0 }}
              >
                <Switch
                  value={getEffectiveState(env.id)}
                  onChange={(val) => onToggle(env.id, val)}
                  disabled={!canToggle(env.id)}
                  size="3"
                />
              </Flex>
            ))}
          </Flex>

          {/* Live row */}
          <Flex align="center" py="2">
            <Box style={{ width: LABEL_W, flexShrink: 0 }}>
              <Text size="small" weight="semibold">
                Live
              </Text>
              <div
                style={{ fontSize: "0.75em", color: "var(--color-text-low)" }}
              >
                revision {liveVersion}
              </div>
            </Box>
            {visibleEnvs.map((env) => (
              <Flex
                key={env.id}
                justify="center"
                align="center"
                style={{ width: COL_W, flexShrink: 0 }}
              >
                <EnvStateIcon
                  enabled={liveEnvSettings[env.id]?.enabled ?? false}
                />
              </Flex>
            ))}
          </Flex>

          {/* After change row */}
          <Flex align="center" py="2">
            <Box style={{ width: LABEL_W, flexShrink: 0 }}>
              <Text size="small" weight="semibold">
                After change
              </Text>
              <div
                style={{ fontSize: "0.75em", color: "var(--color-text-low)" }}
              >
                {afterChangeSubtext}
              </div>
            </Box>
            {visibleEnvs.map((env) => (
              <Flex
                key={env.id}
                justify="center"
                align="center"
                style={{ width: COL_W, flexShrink: 0 }}
              >
                <EnvStateIcon enabled={getEffectiveState(env.id)} />
              </Flex>
            ))}
          </Flex>
        </Box>
      </Flex>
    </Box>
  );
}

export interface KillSwitchModalProps {
  // Merged feature (may reflect draft state)
  feature: FeatureInterface;
  // Raw live feature document (un-merged)
  baseFeature?: FeatureInterface;
  // When set, pre-initialises that env to desiredState in the grid
  environment?: string;
  desiredState?: boolean;
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
  const { organization } = useUser();
  const allOrgEnvironments = useEnvironments();
  const ctx = useFeatureRevisionsContext();

  const liveDoc = baseFeature ?? ctx?.baseFeature ?? feature;
  const isAdmin = permissionsUtil.canBypassApprovalChecks(feature);

  const rawRequireReviews = settings?.requireReviews;
  const reviewSetting = Array.isArray(rawRequireReviews)
    ? getReviewSetting(rawRequireReviews, feature)
    : null;

  // featureRequireEnvironmentReview=false bypasses kill-switch gating even when env approvals are on
  const envIsGated: boolean = (() => {
    if (rawRequireReviews === true) return true;
    if (!reviewSetting?.requireReviewOn) return false;
    if (reviewSetting.featureRequireEnvironmentReview === false) return false;
    const gatedEnvs = reviewSetting.environments ?? [];
    return (
      gatedEnvs.length === 0 ||
      (environment != null && gatedEnvs.includes(environment))
    );
  })();

  // "none" when kill-switch approvals are off, even if other change types are gated
  const gatedEnvSet: Set<string> | "all" | "none" = (() => {
    if (!envIsGated) return "none";
    if (rawRequireReviews === true) return "all";
    const gatedEnvs = reviewSetting?.environments ?? [];
    return gatedEnvs.length === 0 ? "all" : new Set(gatedEnvs);
  })();

  const canAutoPublish = isAdmin || !envIsGated;

  const activeDrafts = useMemo(
    () =>
      revisionList.filter((r) =>
        (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
      ),
    [revisionList],
  );

  const viewingActiveDraft = activeDrafts.some(
    (r) => r.version === currentVersion,
  );

  // Pre-select: currentVersion if active draft, else mine, else most recent, else null
  const userId = organization?.ownerEmail;
  const defaultDraft = useMemo((): number | null => {
    if (activeDrafts.find((r) => r.version === currentVersion))
      return currentVersion;
    const byMe = activeDrafts.find(
      (r) =>
        r.createdBy &&
        "id" in r.createdBy &&
        (r.createdBy as { id?: string }).id === userId,
    );
    if (byMe) return byMe.version;
    return activeDrafts[0]?.version ?? null;
  }, [activeDrafts, currentVersion, userId]);

  const [mode, setMode] = useState<DraftMode>(
    viewingActiveDraft ? "existing" : "new",
  );
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );
  // Envs explicitly toggled by the user during this modal session.
  const [touchedEnvs, setTouchedEnvs] = useState<Set<string>>(new Set());
  // Per-env overrides applied by the user in the "Change State" row.
  const [envOverrides, setEnvOverrides] = useState<Record<string, boolean>>({});

  // Wrap mode/draft setters so that touched overrides are always preserved
  // while un-touched envs are free to follow the newly selected base.
  const handleSetMode = (m: DraftMode) => {
    setMode(m);
    setEnvOverrides((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([k]) => touchedEnvs.has(k)),
      ),
    );
  };
  const handleSetSelectedDraft = (v: number | null) => {
    setSelectedDraft(v);
    setEnvOverrides((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([k]) => touchedEnvs.has(k)),
      ),
    );
  };

  const draftVersionForFetch = !ctx ? selectedDraft : null;
  const { data: fetchedRevisionsData } = useApi<{
    status: 200;
    revisions: FeatureRevisionInterface[];
  }>(
    `/feature/${feature.id}/revisions?versions=${feature.version},${draftVersionForFetch ?? 0}`,
    { shouldRun: () => draftVersionForFetch != null },
  );
  const revisions = ctx?.revisions ?? fetchedRevisionsData?.revisions;

  const visibleEnvs = useMemo(
    () => filterEnvironmentsByFeature(allOrgEnvironments, liveDoc),
    [allOrgEnvironments, liveDoc],
  );

  // Base enabled state per env: live (filled) for new/publish, effective draft for existing.
  const baseEnvEnabled = useMemo<Record<string, boolean>>(() => {
    const liveRevision = revisions?.find((r) => r.version === feature.version);
    if (liveRevision) {
      const filledLive = liveRevisionFromFeature(liveRevision, liveDoc);
      if (mode === "existing" && selectedDraft != null) {
        const draftRevision = revisions?.find(
          (r) => r.version === selectedDraft,
        );
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
  }, [revisions, liveDoc, feature.version, mode, selectedDraft]);

  const getEffectiveState = (envId: string): boolean => {
    if (envId in envOverrides) return envOverrides[envId];
    if (environment === envId && desiredState !== undefined)
      return desiredState;
    return baseEnvEnabled[envId] ?? false;
  };

  const canToggleEnv = (envId: string) =>
    permissionsUtil.canPublishFeature(feature, [envId]);

  const submit = async () => {
    const modePayload = (resolvedDraftVer?: number) =>
      mode === "publish"
        ? { autoPublish: true }
        : mode === "existing"
          ? { draftVersion: selectedDraft }
          : resolvedDraftVer != null
            ? { draftVersion: resolvedDraftVer }
            : { forceNewDraft: true };

    let resolvedDraftVersion: number | undefined;
    for (const env of visibleEnvs) {
      const effective = getEffectiveState(env.id);
      if (effective === (baseEnvEnabled[env.id] ?? false)) continue;
      const res = await apiCall<{ status: 200; draftVersion?: number }>(
        `/feature/${feature.id}/toggle`,
        {
          method: "POST",
          body: JSON.stringify({
            environment: env.id,
            state: effective,
            ...modePayload(resolvedDraftVersion),
          }),
        },
      );
      if (res?.draftVersion != null) resolvedDraftVersion = res.draftVersion;
      track("Feature Environment Toggle", {
        environment: env.id,
        enabled: effective,
        autoPublish: mode === "publish",
      });
    }
    await mutate();
    const finalVersion =
      resolvedDraftVersion ?? (mode === "existing" ? selectedDraft : null);
    if (finalVersion != null) setVersion(finalVersion);
  };

  const noNetChange = visibleEnvs.every(
    (env) =>
      getEffectiveState(env.id) ===
      (liveDoc.environmentSettings?.[env.id]?.enabled ?? false),
  );

  const modalHeader = environment
    ? `${desiredState ? "Enable" : "Disable"} ${environment}`
    : "Manage Kill Switches";

  return (
    <Modal
      trackingEventModalType="kill-switch-toggle"
      header={modalHeader}
      close={close}
      open={true}
      cta={mode === "publish" ? "Publish now" : "Save to draft"}
      size="lg"
      submit={submit}
      useRadixButton={true}
    >
      <div style={{ minHeight: 300 }}>
        <DraftSelectorForChanges
          feature={feature}
          baseFeature={baseFeature}
          revisionList={revisionList}
          mode={mode}
          setMode={handleSetMode}
          selectedDraft={selectedDraft}
          setSelectedDraft={handleSetSelectedDraft}
          canAutoPublish={canAutoPublish}
          gatedEnvSet={gatedEnvSet}
          defaultExpanded
        />
        <EnvStateGrid
          liveFeature={liveDoc}
          visibleEnvs={visibleEnvs}
          getEffectiveState={getEffectiveState}
          onToggle={(envId, val) => {
            setTouchedEnvs((prev) => new Set([...prev, envId]));
            setEnvOverrides((prev) => ({ ...prev, [envId]: val }));
          }}
          canToggle={canToggleEnv}
          liveVersion={liveDoc.version}
          afterChangeSubtext={
            mode === "existing" && selectedDraft != null
              ? `draft ${selectedDraft}`
              : mode === "publish"
                ? "new revision"
                : "new draft"
          }
        />
        {noNetChange && touchedEnvs.size > 0 && (
          <Box mt="2">
            <Text as="p" size="small" color="text-low">
              <em>
                {mode === "existing"
                  ? "This undoes pending draft changes — no net change from live."
                  : mode === "publish"
                    ? "Already matches live — nothing will be published."
                    : "Already matches live — this will have no effect."}
              </em>
            </Text>
          </Box>
        )}
      </div>
    </Modal>
  );
}

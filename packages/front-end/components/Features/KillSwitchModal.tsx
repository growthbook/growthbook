import { useEffect, useMemo, useState } from "react";
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

const COL_W = 120;
const LABEL_W = 140;

function EnvStateGrid({
  liveFeature,
  visibleEnvs,
  getEffectiveState,
  getSwitchDisplayState,
  onToggle,
  canToggle,
}: {
  liveFeature: FeatureInterface;
  visibleEnvs: Environment[];
  getEffectiveState: (envId: string) => boolean;
  getSwitchDisplayState: (envId: string) => boolean;
  onToggle: (envId: string, val: boolean) => void;
  canToggle: (envId: string) => boolean;
}) {
  const liveEnvSettings = liveFeature.environmentSettings ?? {};

  return (
    <Box style={{ overflowX: "auto", textAlign: "center" }}>
      <Flex
        direction="column"
        style={{
          minWidth: "max-content",
          display: "inline-flex",
          textAlign: "left",
        }}
      >
        {/* Env name header */}
        <Flex align="center" pb="1">
          <Box style={{ width: LABEL_W, flexShrink: 0 }} />
          {visibleEnvs.map((env) => (
            <Box
              key={env.id}
              style={{ width: COL_W, flexShrink: 0, textAlign: "center" }}
            >
              <Text weight="semibold" color="text-mid">
                <OverflowText maxWidth={COL_W}>{env.id}</OverflowText>
              </Text>
            </Box>
          ))}
        </Flex>

        {/* Switches row */}
        <Flex align="center" pt="1" pb="3">
          <Box style={{ width: LABEL_W, flexShrink: 0 }} />
          {visibleEnvs.map((env) => (
            <Flex
              key={env.id}
              justify="center"
              align="center"
              style={{ width: COL_W, flexShrink: 0 }}
            >
              <Switch
                value={getSwitchDisplayState(env.id)}
                onChange={(val) => onToggle(env.id, val)}
                disabled={!canToggle(env.id)}
                size="3"
              />
            </Flex>
          ))}
        </Flex>

        {/* Change summary */}
        <Box mt="2" pb="1">
          <Flex
            align="center"
            pb="2"
            style={{ borderBottom: "1px solid var(--gray-4)" }}
          >
            <Box style={{ width: LABEL_W, flexShrink: 0 }}>
              <Text color="text-mid">Change summary</Text>
            </Box>
          </Flex>

          <Box style={{ position: "relative" }}>
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

            <Flex align="center" my="1">
              <Box style={{ width: LABEL_W, flexShrink: 0 }}>
                <Text weight="semibold">Live</Text>
              </Box>
              {visibleEnvs.map((env) => {
                const unchanged =
                  (liveEnvSettings[env.id]?.enabled ?? false) ===
                  getEffectiveState(env.id);
                return (
                  <Box key={env.id} style={{ width: COL_W, flexShrink: 0 }}>
                    <Flex
                      justify="center"
                      align="center"
                      py="2"
                      mx="1"
                      style={{
                        borderRadius: "var(--radius-2)",
                        background: unchanged ? "var(--gray-3)" : undefined,
                      }}
                    >
                      <span style={{ opacity: unchanged ? 0.5 : 1 }}>
                        <EnvStateIcon
                          enabled={liveEnvSettings[env.id]?.enabled ?? false}
                        />
                      </span>
                    </Flex>
                  </Box>
                );
              })}
            </Flex>

            <Flex align="center" my="1">
              <Box style={{ width: LABEL_W, flexShrink: 0 }}>
                <Text weight="semibold">After change</Text>
              </Box>
              {visibleEnvs.map((env) => {
                const unchanged =
                  (liveEnvSettings[env.id]?.enabled ?? false) ===
                  getEffectiveState(env.id);
                return (
                  <Box key={env.id} style={{ width: COL_W, flexShrink: 0 }}>
                    <Flex
                      justify="center"
                      align="center"
                      py="2"
                      mx="1"
                      style={{
                        borderRadius: "var(--radius-2)",
                        background: unchanged ? "var(--gray-3)" : undefined,
                      }}
                    >
                      <span style={{ opacity: unchanged ? 0.5 : 1 }}>
                        <EnvStateIcon enabled={getEffectiveState(env.id)} />
                      </span>
                    </Flex>
                  </Box>
                );
              })}
            </Flex>
          </Box>
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

  // Envs explicitly toggled by the user during this modal session.
  const [touchedEnvs, setTouchedEnvs] = useState<Set<string>>(new Set());
  // Per-env overrides applied by the user in the "Change State" row.
  const [envOverrides, setEnvOverrides] = useState<Record<string, boolean>>({});

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

  // Which envs have an approval policy for kill-switch changes (badge coloring).
  // featureRequireEnvironmentReview=false means kill-switch changes bypass env approvals.
  const gatedEnvSet: Set<string> | "all" | "none" = (() => {
    if (rawRequireReviews === true) return "all";
    if (!reviewSetting?.requireReviewOn) return "none";
    if (reviewSetting.featureRequireEnvironmentReview === false) return "none";
    const gatedEnvs = reviewSetting.environments ?? [];
    return gatedEnvs.length === 0 ? "all" : new Set(gatedEnvs);
  })();

  // Gated only when the proposal actually flips a gated env's switch from live.
  const liveEnvSettings = liveDoc.environmentSettings ?? {};
  const envIsGated =
    gatedEnvSet !== "none" &&
    visibleEnvs.some((env) => {
      const isGated = gatedEnvSet === "all" || gatedEnvSet.has(env.id);
      if (!isGated) return false;
      return getEffectiveState(env.id) !== !!liveEnvSettings[env.id]?.enabled;
    });

  const canAutoPublish = isAdmin || !envIsGated;

  // Reset mode if "publish now" becomes unavailable due to a newly gated change.
  useEffect(() => {
    if (!canAutoPublish && mode === "publish") {
      setMode("new");
    }
  }, [canAutoPublish, mode]);

  // Delay the switch animation for pre-toggled envs so users see it animate in.
  const [uiReady, setUiReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setUiReady(true), 100);
    return () => clearTimeout(t);
  }, []);
  const getSwitchDisplayState = (envId: string): boolean => {
    if (!uiReady && environment === envId && desiredState !== undefined) {
      return baseEnvEnabled[envId] ?? false;
    }
    return getEffectiveState(envId);
  };

  const canToggleEnv = (envId: string) =>
    permissionsUtil.canPublishFeature(feature, [envId]);

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
          gatedEnvSet={envIsGated ? gatedEnvSet : "none"}
          defaultExpanded
        />
        <EnvStateGrid
          liveFeature={liveDoc}
          visibleEnvs={visibleEnvs}
          getEffectiveState={getEffectiveState}
          getSwitchDisplayState={getSwitchDisplayState}
          onToggle={(envId, val) => {
            setTouchedEnvs((prev) => new Set([...prev, envId]));
            setEnvOverrides((prev) => ({ ...prev, [envId]: val }));
          }}
          canToggle={canToggleEnv}
        />

        <Flex justify="center" style={{ minHeight: 50 }}>
          {noNetChange &&
            (touchedEnvs.size > 0 || environment !== undefined) && (
              <Text as="p" color="text-low">
                <em>
                  {mode === "existing"
                    ? "This undoes pending draft changes — no net change from live."
                    : mode === "publish"
                      ? "Already matches live — nothing will be published."
                      : "Already matches live — this will have no effect."}
                </em>
              </Text>
            )}
        </Flex>
      </div>
    </Modal>
  );
}

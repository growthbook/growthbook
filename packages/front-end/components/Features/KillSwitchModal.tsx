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
import {
  getReviewSetting,
  liveRevisionFromFeature,
  buildEffectiveDraft,
  filterEnvironmentsByFeature,
} from "shared/util";
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
  baseEnvEnabled,
  allOrgEnvironments,
  changedEnv,
  desiredState,
  liveVersion,
  afterChangeSubtext,
}: {
  liveFeature: FeatureInterface;
  // Per-env enabled state of the base revision the change will be applied on top of
  baseEnvEnabled: Record<string, boolean>;
  allOrgEnvironments: Environment[];
  changedEnv: string;
  desiredState: boolean;
  liveVersion: number;
  afterChangeSubtext: string;
}) {
  const COL_W = 70;
  const LABEL_W = 156;
  const ROW_PY = 6;

  const liveEnvSettings = liveFeature.environmentSettings ?? {};
  // Filter by project membership, not just by stored settings keys
  const visibleEnvs = filterEnvironmentsByFeature(
    allOrgEnvironments,
    liveFeature,
  );

  return (
    <Box my="4" style={{ overflowX: "auto" }}>
      <Flex direction="column" style={{ minWidth: "max-content" }}>
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
                : (baseEnvEnabled[env.id] ?? false);
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
  // Merged feature (may reflect draft state)
  feature: FeatureInterface;
  // Raw live feature document (un-merged)
  baseFeature?: FeatureInterface;
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
    return gatedEnvs.length === 0 || gatedEnvs.includes(environment);
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

  const draftVersionForFetch = !ctx ? selectedDraft : null;
  const { data: fetchedRevisionsData } = useApi<{
    status: 200;
    revisions: FeatureRevisionInterface[];
  }>(
    `/feature/${feature.id}/revisions?versions=${feature.version},${draftVersionForFetch ?? 0}`,
    { shouldRun: () => draftVersionForFetch != null },
  );
  const revisions = ctx?.revisions ?? fetchedRevisionsData?.revisions;

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

  const submit = async () => {
    const res = await apiCall<{ status: 200; draftVersion?: number }>(
      `/feature/${feature.id}/toggle`,
      {
        method: "POST",
        body: JSON.stringify({
          environment,
          state: desiredState,
          ...(mode === "publish"
            ? { autoPublish: true }
            : mode === "existing"
              ? { draftVersion: selectedDraft }
              : { forceNewDraft: true }),
        }),
      },
    );
    track("Feature Environment Toggle", {
      environment,
      enabled: desiredState,
      autoPublish: mode === "publish",
    });
    await mutate();
    const resolvedVersion =
      res?.draftVersion ?? (mode === "existing" ? selectedDraft : null);
    if (resolvedVersion != null) setVersion(resolvedVersion);
  };

  const actionLabel = desiredState ? "Enable" : "Disable";

  const noNetChange =
    desiredState ===
    (liveDoc.environmentSettings?.[environment]?.enabled ?? false);

  return (
    <Modal
      trackingEventModalType="kill-switch-toggle"
      header={`${actionLabel} ${environment}`}
      close={close}
      open={true}
      cta={mode === "publish" ? `${actionLabel} now` : "Save to draft"}
      submit={submit}
      useRadixButton={true}
    >
      <div style={{ minHeight: 300 }}>
        <DraftSelectorForChanges
          feature={feature}
          baseFeature={baseFeature}
          revisionList={revisionList}
          mode={mode}
          setMode={setMode}
          selectedDraft={selectedDraft}
          setSelectedDraft={setSelectedDraft}
          canAutoPublish={canAutoPublish}
          gatedEnvSet={gatedEnvSet}
          defaultExpanded
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
          liveFeature={liveDoc}
          baseEnvEnabled={baseEnvEnabled}
          allOrgEnvironments={allOrgEnvironments}
          changedEnv={environment}
          desiredState={desiredState}
          liveVersion={liveDoc.version}
          afterChangeSubtext={
            mode === "existing" && selectedDraft != null
              ? `revision ${selectedDraft}`
              : mode === "publish"
                ? "new revision"
                : "new draft"
          }
        />
        {noNetChange && (
          <Box mt="2">
            <Text as="p" size="small" color="text-low">
              <em>
                {mode === "existing" ? (
                  <>
                    This undoes a pending draft change —{" "}
                    <strong>{environment}</strong> will match live with no net
                    change.
                  </>
                ) : mode === "publish" ? (
                  <>
                    <strong>{environment}</strong> already matches live —
                    nothing will be published.
                  </>
                ) : (
                  <>
                    <strong>{environment}</strong> already matches live — this
                    will have no effect.
                  </>
                )}
              </em>
            </Text>
          </Box>
        )}
      </div>
    </Modal>
  );
}

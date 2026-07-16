import { FeatureInterface } from "shared/types/feature";
import { useEffect, useMemo, useState } from "react";
import { PiPlusBold } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  SafeRolloutInterface,
  HoldoutInterface,
  RampScheduleInterface,
} from "shared/validators";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import { Box, Flex } from "@radix-ui/themes";
import RuleModal from "@/components/Features/RuleModal/index";
import RuleList from "@/components/Features/RuleList";
import track from "@/services/track";
import { getRules } from "@/services/features";
import { isHoldoutEnabledAnyEnv } from "@/hooks/useHoldouts";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import HoldoutValueModal from "./HoldoutValueModal";

export default function FeatureRules({
  environments,
  feature,
  isLocked,
  lockedBySchedule,
  canEditDrafts,
  experimentsMap,
  mutate,
  currentVersion,
  setVersion,
  isDraft,
  safeRolloutsMap,
  holdout,
  baseFeature,
  revisionList,
  rampSchedules,
  draftRevision,
  baseRevision,
  pendingRuleEdit,
  onPendingRuleEditHandled,
  env,
  setEnv,
  hideInactive,
  showOrphaned,
}: {
  environments: Environment[];
  feature: FeatureInterface;
  baseFeature: FeatureInterface;
  isLocked: boolean;
  // `isLocked` is due to a pending scheduled publish; ramp controls stay interactive.
  lockedBySchedule?: boolean;
  canEditDrafts: boolean;
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
  mutate: () => Promise<unknown>;
  currentVersion: number;
  setVersion: (v: number) => void;
  isDraft: boolean;
  safeRolloutsMap: Map<string, SafeRolloutInterface>;
  holdout: HoldoutInterface | undefined;
  revisionList: MinimalFeatureRevisionInterface[];
  rampSchedules?: RampScheduleInterface[];
  draftRevision?: FeatureRevisionInterface | null;
  // The revision the draft is based on — used to tell an intentional disable
  // from a stale-inherited one when live has diverged.
  baseRevision?: FeatureRevisionInterface | null;
  pendingRuleEdit?: { environment: string; ruleId: string } | null;
  onPendingRuleEditHandled?: () => void;
  // Selected env tab (null = "All environments"), already normalized. Owned by
  // the parent so the shared tab bar and the Default Value section stay in sync.
  env: string | null;
  setEnv: (v: string | null) => void;
  hideInactive: boolean;
  showOrphaned: boolean;
}) {
  const envs = environments.map((e) => e.id);

  // Orphaned: non-empty `environments` list referencing only deleted envs.
  // `environments: []` (pending) and `allEnvironments: true` are not orphaned.
  // Memoized so RuleList's `hiddenRuleIds` effect dep stays stable.
  const orphanedRuleIds = useMemo(() => {
    const knownEnvIds = new Set(environments.map((e) => e.id));
    return new Set<string>(
      (feature.rules ?? [])
        .filter(
          (r) =>
            r &&
            !r.allEnvironments &&
            Array.isArray(r.environments) &&
            r.environments.length > 0 &&
            r.environments.every((e) => !knownEnvIds.has(e)),
        )
        .map((r) => r.id)
        .filter((id): id is string => !!id),
    );
  }, [feature.rules, environments]);

  // Externally triggered rule open (e.g. ramp timeline CTA). Switch to the
  // requested env if it projects there, else any env that has it.
  useEffect(() => {
    if (!pendingRuleEdit) return;
    const { environment, ruleId } = pendingRuleEdit;
    const handled = () => onPendingRuleEditHandled?.();

    const flatIdx = (feature.rules ?? []).findIndex((r) => r.id === ruleId);
    if (flatIdx === -1) {
      handled();
      return;
    }

    const preferredHas =
      getRules(feature, environment).findIndex((r) => r.id === ruleId) !== -1;
    const projectedEnv = preferredHas
      ? environment
      : (environments.find(
          (e) =>
            getRules(feature, e.id).findIndex((r) => r.id === ruleId) !== -1,
        )?.id ?? "");

    setEnv(projectedEnv || null);
    setRuleModal({
      i: flatIdx,
      environment: projectedEnv,
      ruleId,
      mode: "edit",
    });
    handled();
  }, [pendingRuleEdit]); // eslint-disable-line react-hooks/exhaustive-deps
  const [ruleModal, setRuleModal] = useState<{
    i: number;
    environment: string;
    ruleId?: string;
    defaultType?: string;
    mode: "create" | "edit" | "duplicate";
    detachRampOnSave?: boolean;
  } | null>(null);
  const [holdoutModal, setHoldoutModal] = useState<boolean>(false);

  const rulesByEnv = Object.fromEntries(
    environments.map((e) => {
      const rules = getRules(feature, e.id);
      return [e.id, rules];
    }),
  );

  const activeEnv =
    env === null ? null : (environments.find((e) => e.id === env) ?? null);
  const holdoutEnabledInActiveEnv =
    !!activeEnv && !!holdout?.environmentSettings?.[activeEnv.id]?.enabled;
  const liveHoldoutActive = !!holdout && holdoutEnabledInActiveEnv;
  const draftDeletesHoldout =
    !feature.holdout?.id &&
    !!baseFeature.holdout?.id &&
    holdoutEnabledInActiveEnv;
  const includeHoldoutRule = liveHoldoutActive || draftDeletesHoldout;

  // Show holdout in All-Envs whenever it's enabled in any of the org's envs.
  const holdoutEnabledAnyEnv = isHoldoutEnabledAnyEnv(holdout, envs);
  const liveHoldoutActiveAnyEnv = !!feature.holdout?.id && holdoutEnabledAnyEnv;
  const draftDeletesHoldoutAnyEnv =
    !feature.holdout?.id && !!baseFeature.holdout?.id && holdoutEnabledAnyEnv;
  const includeHoldoutRuleAllEnvs =
    liveHoldoutActiveAnyEnv || draftDeletesHoldoutAnyEnv;

  return (
    <>
      <Box mt="4">
        {env === null ? (
          <>
            {(feature.rules ?? []).length > 0 || includeHoldoutRuleAllEnvs ? (
              <RuleList
                allEnvsView
                environments={environments}
                feature={feature}
                baseFeature={baseFeature}
                mutate={mutate}
                setRuleModal={setRuleModal}
                version={currentVersion}
                setVersion={setVersion}
                locked={isLocked}
                lockedBySchedule={lockedBySchedule}
                experimentsMap={experimentsMap}
                hideInactive={hideInactive}
                isDraft={isDraft}
                safeRolloutsMap={safeRolloutsMap}
                holdout={liveHoldoutActiveAnyEnv ? holdout : undefined}
                holdoutIsDeleted={draftDeletesHoldoutAnyEnv}
                openHoldoutModal={() => setHoldoutModal(true)}
                revisionList={revisionList}
                rampSchedules={rampSchedules}
                draftRevision={draftRevision}
                baseRevision={baseRevision}
                hiddenRuleIds={showOrphaned ? undefined : orphanedRuleIds}
              />
            ) : (
              <Box className="text-muted">
                <em>No rules have been added yet.</em>
              </Box>
            )}
            {!isLocked && (
              <Flex mt="5" mb="1" justify="end">
                <Button
                  disabled={!canEditDrafts}
                  onClick={() => {
                    // environment="" → rule modal defaults to allEnvironments scope
                    setRuleModal({
                      environment: "",
                      i: (feature.rules ?? []).length,
                      mode: "create",
                    });
                    track("Viewed Rule Modal", {
                      source: "add-rule",
                      type: "force",
                    });
                  }}
                  icon={<PiPlusBold />}
                >
                  Add Rule
                </Button>
              </Flex>
            )}
          </>
        ) : activeEnv ? (
          <>
            {rulesByEnv[activeEnv.id]?.length > 0 || includeHoldoutRule ? (
              <RuleList
                environment={activeEnv.id}
                feature={feature}
                baseFeature={baseFeature}
                mutate={mutate}
                setRuleModal={setRuleModal}
                version={currentVersion}
                setVersion={setVersion}
                locked={isLocked}
                lockedBySchedule={lockedBySchedule}
                experimentsMap={experimentsMap}
                hideInactive={hideInactive}
                isDraft={isDraft}
                safeRolloutsMap={safeRolloutsMap}
                holdout={liveHoldoutActive ? holdout : undefined}
                holdoutIsDeleted={draftDeletesHoldout}
                openHoldoutModal={() => setHoldoutModal(true)}
                revisionList={revisionList}
                rampSchedules={rampSchedules}
                draftRevision={draftRevision}
                baseRevision={baseRevision}
              />
            ) : (
              <Box className="text-muted">
                <em>No rules have been added to this environment yet.</em>
              </Box>
            )}
            {!isLocked && (
              <>
                <Flex pt="4" justify="between" align="center">
                  <Text weight="semibold" size="large">
                    Add rule to {activeEnv.id}
                  </Text>
                  <Button
                    disabled={!canEditDrafts}
                    onClick={() => {
                      setRuleModal({
                        environment: activeEnv.id,
                        i: (feature.rules ?? []).length,
                        mode: "create",
                      });
                    }}
                  >
                    Add Rule
                  </Button>
                </Flex>
              </>
            )}
          </>
        ) : null}
      </Box>
      {ruleModal !== null && (
        <RuleModal
          feature={feature}
          baseFeature={baseFeature}
          close={() => setRuleModal(null)}
          i={ruleModal.i}
          ruleId={ruleModal.ruleId}
          safeRolloutsMap={safeRolloutsMap}
          environment={ruleModal.environment}
          mutate={mutate}
          defaultType={ruleModal.defaultType || ""}
          setVersion={setVersion}
          mode={ruleModal.mode}
          revisionList={revisionList}
          rampSchedules={rampSchedules}
          detachRampOnSave={ruleModal.detachRampOnSave}
          draftRevision={draftRevision}
        />
      )}
      {holdoutModal && (
        <HoldoutValueModal
          feature={feature}
          revisionList={revisionList}
          close={() => setHoldoutModal(false)}
          mutate={mutate}
          setVersion={setVersion}
        />
      )}
    </>
  );
}

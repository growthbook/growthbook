import { FeatureInterface } from "shared/types/feature";
import { useEffect, useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  FeatureRule,
  SafeRolloutInterface,
  HoldoutInterface,
  RampScheduleInterface,
} from "shared/validators";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import { Box, Container, Flex, Text } from "@radix-ui/themes";
import clsx from "clsx";
import { PiPlusBold } from "react-icons/pi";
import RuleModal from "@/components/Features/RuleModal/index";
import RuleList from "@/components/Features/RuleList";
import track from "@/services/track";
import { getRules, isRuleInactive } from "@/services/features";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Switch from "@/ui/Switch";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import EnvironmentDropdown from "@/components/Environments/EnvironmentDropdown";
import { useAuth } from "@/services/auth";
import HoldoutValueModal from "./HoldoutValueModal";
import EnvFilterTrigger from "./EnvFilterTrigger";
import { Rule, SortableRule } from "./Rule";

export default function FeatureRules({
  environments,
  feature,
  isLocked,
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
  pendingRuleEdit,
  onPendingRuleEditHandled,
}: {
  environments: Environment[];
  feature: FeatureInterface;
  baseFeature: FeatureInterface;
  isLocked: boolean;
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
  pendingRuleEdit?: { environment: string; ruleId: string } | null;
  onPendingRuleEditHandled?: () => void;
}) {
  const { apiCall } = useAuth();
  const envs = environments.map((e) => e.id);
  // null = "All environments" (unfiltered view); string = specific env filter
  const [env, setEnv] = useState<string | null>(null);
  // Optimistic local copy of feature.rules for the all-envs DnD view.
  const [allEnvItems, setAllEnvItems] = useState<FeatureRule[]>(
    feature.rules ?? [],
  );
  const [allEnvDragId, setAllEnvDragId] = useState<string | null>(null);
  useEffect(() => {
    setAllEnvItems(feature.rules ?? []);
  }, [feature.rules]);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const [hideInactive, setHideInactive] = useLocalStorage(
    "hide-disabled-rules",
    false,
  );
  const hasInactiveRules = (feature.rules ?? []).some((r) =>
    isRuleInactive(r, experimentsMap),
  );

  // Open the rule modal when triggered externally (e.g. from the ramp
  // timeline CTA). The RuleModal resolves rules by (env, positional index),
  // so pending rules (`environments: []`) and rules that don't apply to the
  // caller-supplied env need a fallback: search every env's projection for a
  // match, prefer the caller's env if present, else pick the first env where
  // the rule appears.
  useEffect(() => {
    if (!pendingRuleEdit) return;
    const { environment, ruleId } = pendingRuleEdit;

    // Try preferred env first, then any env the rule projects into.
    const preferredRules = getRules(feature, environment);
    const preferredIdx = preferredRules.findIndex((r) => r.id === ruleId);
    if (preferredIdx !== -1) {
      setEnv(environment);
      setRuleModal({ i: preferredIdx, environment, ruleId, mode: "edit" });
      onPendingRuleEditHandled?.();
      return;
    }

    for (const e of environments) {
      if (e.id === environment) continue;
      const projected = getRules(feature, e.id);
      const idx = projected.findIndex((r) => r.id === ruleId);
      if (idx !== -1) {
        setEnv(e.id);
        setRuleModal({ i: idx, environment: e.id, ruleId, mode: "edit" });
        onPendingRuleEditHandled?.();
        return;
      }
    }

    // Pending rule (environments: []) doesn't project into any env tab.
    // Switch to the "All environments" flat view and open by ruleId.
    const flatRule = (feature.rules ?? []).find((r) => r.id === ruleId);
    if (flatRule) {
      setEnv(null);
      setRuleModal({
        i: -1,
        environment: environments[0]?.id ?? "",
        ruleId,
        mode: "edit",
      });
      onPendingRuleEditHandled?.();
      return;
    }

    console.warn(`[deep-link] rule "${ruleId}" not found in feature.rules`);
    onPendingRuleEditHandled?.();
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

  // If the selected env is removed from the org's environment list, fall back
  // to the "All environments" view rather than showing a blank tab.
  useEffect(() => {
    if (env !== null && !envs.includes(env)) {
      setEnv(null);
    }
  }, [envs, env]);

  const rulesByEnv = Object.fromEntries(
    environments.map((e) => {
      const rules = getRules(feature, e.id);
      return [e.id, rules];
    }),
  );

  const tabEnvs = environments.slice(0, 4);
  const dropdownEnvs = environments.slice(4);
  const selectedDropdownEnv = dropdownEnvs.find((e) => e.id === env)?.id;

  // null env = "All environments" unfiltered view; otherwise filter to the selected env.
  const activeEnv =
    env === null ? null : (environments.find((e) => e.id === env) ?? null);
  const liveHoldoutActive =
    !!activeEnv &&
    !!holdout &&
    !!holdout?.environmentSettings?.[activeEnv.id]?.enabled;
  const draftDeletesHoldout =
    !!activeEnv &&
    !feature.holdout?.id &&
    !!baseFeature.holdout?.id &&
    !!holdout?.environmentSettings?.[activeEnv.id]?.enabled;
  const includeHoldoutRule = liveHoldoutActive || draftDeletesHoldout;

  return (
    <>
      <Flex align="center" justify="between" mb="3" wrap="wrap" gap="2">
        <Flex wrap="wrap" flexGrow="1" gap="2" align="center">
          <EnvFilterTrigger
            label="All Environments"
            count={feature.rules?.length ?? 0}
            isActive={env === null}
            onClick={() => setEnv(null)}
          />

          {tabEnvs.map((e) => {
            // A single rule can apply to many envs post-unification, so
            // the same rule legitimately contributes to multiple tab counts.
            const count = holdout?.environmentSettings?.[e.id]?.enabled
              ? rulesByEnv[e.id].length + 1
              : rulesByEnv[e.id].length;
            return (
              <EnvFilterTrigger
                key={e.id}
                label={e.id}
                count={count}
                isActive={env === e.id}
                onClick={() => setEnv(e.id)}
              />
            );
          })}

          {dropdownEnvs.length === 1 &&
            (() => {
              const e = dropdownEnvs[0];
              const count = holdout?.environmentSettings[e.id]?.enabled
                ? rulesByEnv[e.id].length + 1
                : rulesByEnv[e.id].length;
              return (
                <EnvFilterTrigger
                  label={e.id}
                  count={count}
                  isActive={env === e.id}
                  onClick={() => setEnv(e.id)}
                />
              );
            })()}
        </Flex>

        <Flex align="center" flexShrink="0">
          {dropdownEnvs.length > 1 && (
            <Flex
              px="1"
              direction="column"
              justify="center"
              align="center"
              className={clsx("tab-trigger-container", {
                active: !!selectedDropdownEnv,
              })}
            >
              <Container
                flexGrow="0"
                minWidth={selectedDropdownEnv ? undefined : "100px"}
              >
                <EnvironmentDropdown
                  containerClassName={"select-dropdown-no-underline"}
                  env={selectedDropdownEnv}
                  setEnv={setEnv}
                  environments={dropdownEnvs}
                  placeholder="Other..."
                  formatOptionLabel={({ value }) => (
                    <Flex align="center">
                      <Flex maxWidth="150px">
                        <Text weight="medium" truncate title={value}>
                          {value}
                        </Text>
                      </Flex>
                      <Badge
                        ml="2"
                        mr="3"
                        label={
                          holdout?.environmentSettings[value].enabled
                            ? (rulesByEnv[value].length + 1).toString()
                            : rulesByEnv[value].length.toString()
                        }
                        radius="full"
                        variant="solid"
                        color="violet"
                      />
                    </Flex>
                  )}
                />
              </Container>
            </Flex>
          )}

          <Switch
            size="1"
            value={!hasInactiveRules ? false : !hideInactive}
            onChange={(v) => setHideInactive(!v)}
            disabled={!hasInactiveRules}
            label="Show inactive"
          />
        </Flex>
      </Flex>

      {/* Single content area — filtered by active env, null = show all */}
      <div className="mt-2">
        {env === null ? (
          <>
            {allEnvItems.length > 0 ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={({ active }) => {
                  if (!canEditDrafts || isLocked) return;
                  setAllEnvDragId(active.id as string);
                }}
                onDragEnd={async ({ active, over }) => {
                  if (!canEditDrafts || isLocked) {
                    setAllEnvDragId(null);
                    return;
                  }
                  if (over && active.id !== over.id) {
                    const oldIndex = allEnvItems.findIndex(
                      (r) => r.id === active.id,
                    );
                    const newIndex = allEnvItems.findIndex(
                      (r) => r.id === over.id,
                    );
                    if (oldIndex === -1 || newIndex === -1) return;
                    setAllEnvItems((prev) =>
                      arrayMove(prev, oldIndex, newIndex),
                    );
                    const res = await apiCall<{ version: number }>(
                      `/feature/${feature.id}/${currentVersion}/reorder`,
                      {
                        method: "POST",
                        body: JSON.stringify({ from: oldIndex, to: newIndex }),
                      },
                    );
                    await mutate();
                    if (res.version) setVersion(res.version);
                  }
                  setAllEnvDragId(null);
                }}
              >
                <SortableContext
                  items={allEnvItems}
                  strategy={verticalListSortingStrategy}
                >
                  <Flex direction="column" gap="3">
                    {allEnvItems.map((rule) => {
                      // All-envs view: address rules by ID, not by env-projected
                      // index. This works for all rules including pending ones
                      // (environments: []) that don't project into any env tab.
                      const displayEnv =
                        rule.allEnvironments === true ||
                        !rule.environments?.length
                          ? (environments[0]?.id ?? "")
                          : rule.environments[0];
                      const rampSchedule = rampSchedules?.find((rs) =>
                        rs.targets.some((t) => t.ruleId === rule.id),
                      );
                      return (
                        <SortableRule
                          key={rule.id}
                          rule={rule}
                          feature={feature}
                          environment={displayEnv}
                          i={-1}
                          ruleId={rule.id}
                          mutate={mutate}
                          setRuleModal={setRuleModal}
                          unreachable={false}
                          version={currentVersion}
                          setVersion={setVersion}
                          locked={isLocked}
                          experimentsMap={experimentsMap}
                          hideInactive={hideInactive}
                          isDraft={isDraft}
                          safeRolloutsMap={safeRolloutsMap}
                          holdout={undefined}
                          rampSchedule={rampSchedule}
                          draftRevision={draftRevision}
                        />
                      );
                    })}
                  </Flex>
                </SortableContext>
                <DragOverlay>
                  {allEnvDragId
                    ? (() => {
                        const rule = allEnvItems.find(
                          (r) => r.id === allEnvDragId,
                        );
                        if (!rule) return null;
                        const displayEnv =
                          rule.allEnvironments === true ||
                          !rule.environments?.length
                            ? (environments[0]?.id ?? "")
                            : rule.environments[0];
                        const rampSchedule = rampSchedules?.find((rs) =>
                          rs.targets.some((t) => t.ruleId === rule.id),
                        );
                        return (
                          <Rule
                            rule={rule}
                            feature={feature}
                            environment={displayEnv}
                            i={-1}
                            ruleId={rule.id}
                            mutate={mutate}
                            setRuleModal={setRuleModal}
                            unreachable={false}
                            version={currentVersion}
                            setVersion={setVersion}
                            locked={isLocked}
                            experimentsMap={experimentsMap}
                            hideInactive={hideInactive}
                            isDraft={isDraft}
                            safeRolloutsMap={safeRolloutsMap}
                            holdout={undefined}
                            rampSchedule={rampSchedule}
                            draftRevision={draftRevision}
                          />
                        );
                      })()
                    : null}
                </DragOverlay>
              </DndContext>
            ) : (
              <Box py="4" className="text-muted">
                <em>No rules have been added yet</em>
              </Box>
            )}
            {canEditDrafts && !isLocked && (
              <>
                <Flex mt="5" mb="1" justify="end">
                  <Button
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
              </>
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
              />
            ) : (
              <Box py="4" className="text-muted">
                <em>No rules have been added to this environment yet</em>
              </Box>
            )}
            {canEditDrafts && !isLocked && (
              <>
                <Flex pt="4" justify="between" align="center">
                  <Text weight="bold" size="3">
                    Add rule to {activeEnv.id}
                  </Text>
                  <Button
                    onClick={() => {
                      setRuleModal({
                        environment: activeEnv.id,
                        i: getRules(feature, activeEnv.id).length,
                        mode: "create",
                      });
                      track("Viewed Rule Modal", {
                        source: "add-rule",
                        type: "force",
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
      </div>
      {ruleModal !== null && (
        <RuleModal
          feature={feature}
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

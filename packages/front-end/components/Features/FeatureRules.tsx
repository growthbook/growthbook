import { FeatureInterface } from "shared/types/feature";
import { useCallback, useEffect, useRef, useState } from "react";
import { PiFunnel, PiPlusBold, PiMagnifyingGlass } from "react-icons/pi";
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
import { Box, Flex, TextField } from "@radix-ui/themes";
import { ruleFootprint } from "shared/util";
import RuleModal from "@/components/Features/RuleModal/index";
import RuleList from "@/components/Features/RuleList";
import { buildRuleRampScheduleMap } from "@/services/rampScheduleHelpers";
import track from "@/services/track";
import {
  getRules,
  getUnreachableRuleIndex,
  isRuleInactive,
  useFeatureRulesEnv,
  FEATURE_RULES_ALL_ENVS,
} from "@/services/features";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Switch from "@/ui/Switch";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";
import { Tabs, TabsList, TabsTrigger } from "@/ui/Tabs";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import { useAuth } from "@/services/auth";
import HoldoutValueModal from "./HoldoutValueModal";
import { Rule, SortableRule } from "./Rule";
import { HoldoutRule } from "./HoldoutRule";

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
  // null = "All environments" view.
  const [storedEnv, setEnv] = useFeatureRulesEnv();
  // Optimistic copy for the all-envs DnD view.
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

  // Stored env may be stale (renamed/removed/cross-org); fall back to All
  // for this render without persisting.
  const env =
    storedEnv !== null && !envs.includes(storedEnv) ? null : storedEnv;

  const rulesByEnv = Object.fromEntries(
    environments.map((e) => {
      const rules = getRules(feature, e.id);
      return [e.id, rules];
    }),
  );

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

  // Show holdout in All-Envs whenever it's enabled in any env.
  const holdoutEnabledAnyEnv =
    !!holdout && envs.some((id) => holdout?.environmentSettings?.[id]?.enabled);
  const liveHoldoutActiveAnyEnv = !!feature.holdout?.id && holdoutEnabledAnyEnv;
  const draftDeletesHoldoutAnyEnv =
    !feature.holdout?.id && !!baseFeature.holdout?.id && holdoutEnabledAnyEnv;
  const includeHoldoutRuleAllEnvs =
    liveHoldoutActiveAnyEnv || draftDeletesHoldoutAnyEnv;

  // Tab overflow: cache each trigger's natural width once, then compute
  // cumulative-width overflow against the tabs-bar. Caching avoids the
  // hide-then-remeasure oscillation.
  const tabsBarRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const widthsRef = useRef<Map<string, number>>(new Map());
  const [containerWidth, setContainerWidth] = useState(0);
  const [measureTick, setMeasureTick] = useState(0);
  const setTriggerRef = useCallback(
    (key: string) => (el: HTMLButtonElement | null) => {
      if (!el) {
        triggerRefs.current.delete(key);
        return;
      }
      triggerRefs.current.set(key, el);
      if (!widthsRef.current.has(key)) {
        const w = el.getBoundingClientRect().width;
        if (w > 0) {
          widthsRef.current.set(key, w);
          setMeasureTick((n) => n + 1);
        }
      }
    },
    [],
  );
  const tabKeysSig = [FEATURE_RULES_ALL_ENVS, ...envs].join("|");

  // Drop cached widths for tabs that no longer exist.
  useEffect(() => {
    const valid = new Set([FEATURE_RULES_ALL_ENVS, ...envs]);
    let changed = false;
    for (const key of widthsRef.current.keys()) {
      if (!valid.has(key)) {
        widthsRef.current.delete(key);
        changed = true;
      }
    }
    if (changed) setMeasureTick((n) => n + 1);
  }, [tabKeysSig, envs]);

  useEffect(() => {
    const root = tabsBarRef.current;
    if (!root) return;
    setContainerWidth(root.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  const computeOverflow = (order: string[]): Set<string> => {
    const out = new Set<string>();
    if (containerWidth <= 0 || widthsRef.current.size === 0) return out;
    let cumulative = 0;
    for (const key of order) {
      const w = widthsRef.current.get(key);
      if (w == null) continue;
      cumulative += w;
      if (cumulative > containerWidth) out.add(key);
    }
    return out;
  };

  // If the active env would clip into overflow, hoist it to position 2 so
  // the current view stays visible.
  const baseOrder = [FEATURE_RULES_ALL_ENVS, ...envs];
  const naturalOverflow = computeOverflow(baseOrder);
  const renderOrder =
    env && naturalOverflow.has(env)
      ? [FEATURE_RULES_ALL_ENVS, env, ...envs.filter((e) => e !== env)]
      : baseOrder;
  const overflowKeys = computeOverflow(renderOrder);
  void measureTick; // re-render dep so overflow recomputes when widths cache

  const envById = new Map(environments.map((e) => [e.id, e]));
  const orderedEnvIds = renderOrder.filter((k) => k !== FEATURE_RULES_ALL_ENVS);
  const overflowLabels: Array<{ key: string; label: string; count: number }> =
    [];
  for (const key of renderOrder) {
    if (!overflowKeys.has(key)) continue;
    if (key === FEATURE_RULES_ALL_ENVS) {
      overflowLabels.push({
        key,
        label: "All Environments",
        count:
          (feature.rules?.length ?? 0) + (includeHoldoutRuleAllEnvs ? 1 : 0),
      });
      continue;
    }
    const e = envById.get(key);
    if (!e) continue;
    const count = holdout?.environmentSettings?.[e.id]?.enabled
      ? rulesByEnv[e.id].length + 1
      : rulesByEnv[e.id].length;
    overflowLabels.push({ key: e.id, label: e.id, count });
  }

  const [moreOpen, setMoreOpen] = useState(false);
  const [overflowSearch, setOverflowSearch] = useState("");
  useEffect(() => {
    if (!moreOpen) setOverflowSearch("");
  }, [moreOpen]);
  const showOverflowSearch = overflowLabels.length >= 5;
  const filteredOverflowLabels = showOverflowSearch
    ? overflowLabels.filter((l) =>
        l.label.toLowerCase().includes(overflowSearch.trim().toLowerCase()),
      )
    : overflowLabels;

  return (
    <>
      <Tabs
        value={env ?? FEATURE_RULES_ALL_ENVS}
        onValueChange={(v) => setEnv(v === FEATURE_RULES_ALL_ENVS ? null : v)}
        mb="3"
      >
        <Flex
          align="center"
          justify="between"
          style={{
            boxShadow: "inset 0 -1px 0 0 var(--slate-a3)",
            position: "relative",
          }}
        >
          <Box
            ref={tabsBarRef}
            style={{
              flex: 1,
              minWidth: 0,
            }}
          >
            <TabsList style={{ boxShadow: "none", flexWrap: "nowrap" }}>
              <TabsTrigger
                value={FEATURE_RULES_ALL_ENVS}
                ref={setTriggerRef(FEATURE_RULES_ALL_ENVS)}
                style={
                  overflowKeys.has(FEATURE_RULES_ALL_ENVS)
                    ? { display: "none" }
                    : undefined
                }
              >
                <Flex align="center" gap="2">
                  All Environments
                  <Badge
                    label={String(
                      (feature.rules?.length ?? 0) +
                        (includeHoldoutRuleAllEnvs ? 1 : 0),
                    )}
                    radius="full"
                    variant="soft"
                    color="gray"
                    size="sm"
                    style={{ marginRight: -4 }}
                  />
                </Flex>
              </TabsTrigger>
              {orderedEnvIds.map((id) => {
                const e = envById.get(id);
                if (!e) return null;
                const count = holdout?.environmentSettings?.[e.id]?.enabled
                  ? rulesByEnv[e.id].length + 1
                  : rulesByEnv[e.id].length;
                return (
                  <TabsTrigger
                    key={e.id}
                    value={e.id}
                    ref={setTriggerRef(e.id)}
                    style={
                      overflowKeys.has(e.id) ? { display: "none" } : undefined
                    }
                  >
                    <Flex align="center" gap="2">
                      {e.id}
                      <Badge
                        label={String(count)}
                        radius="full"
                        variant="soft"
                        color="gray"
                        size="sm"
                        style={{ marginRight: -4 }}
                      />
                    </Flex>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Box>
          <Box
            style={{
              flexShrink: 0,
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              paddingLeft: 8,
            }}
          >
            <DropdownMenu
              menuPlacement="end"
              color="violet"
              variant="soft"
              open={moreOpen}
              onOpenChange={setMoreOpen}
              trigger={
                <Button
                  variant="ghost"
                  color="violet"
                  icon={<PiFunnel />}
                  iconPosition="left"
                >
                  {overflowLabels.length > 0
                    ? `More (${overflowLabels.length})`
                    : "More"}
                </Button>
              }
            >
              <Box px="3" py="2">
                <Flex align="center" gap="2" justify="end">
                  <Text size="small" color="text-low">
                    Show inactive rules
                  </Text>
                  <Switch
                    size="1"
                    value={!hasInactiveRules ? false : !hideInactive}
                    onChange={(v) => setHideInactive(!v)}
                    disabled={!hasInactiveRules}
                  />
                </Flex>
              </Box>
              {overflowLabels.length > 0 && <DropdownMenuSeparator />}
              {showOverflowSearch && (
                <Box px="3" pt="1" pb="2">
                  <TextField.Root
                    size="2"
                    placeholder="Search..."
                    value={overflowSearch}
                    onChange={(e) => setOverflowSearch(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  >
                    <TextField.Slot>
                      <PiMagnifyingGlass />
                    </TextField.Slot>
                  </TextField.Root>
                </Box>
              )}
              {filteredOverflowLabels.map(({ key, label, count }) => (
                <DropdownMenuItem
                  key={key}
                  onClick={() =>
                    setEnv(key === FEATURE_RULES_ALL_ENVS ? null : key)
                  }
                >
                  <Flex align="center" justify="between" gap="3" width="100%">
                    <span>{label}</span>
                    <Badge
                      label={String(count)}
                      radius="full"
                      variant="soft"
                      color="gray"
                      size="sm"
                    />
                  </Flex>
                </DropdownMenuItem>
              ))}
              {showOverflowSearch && filteredOverflowLabels.length === 0 && (
                <Box px="3" py="2">
                  <Text size="small" color="text-low">
                    No matches
                  </Text>
                </Box>
              )}
            </DropdownMenu>
          </Box>
        </Flex>
      </Tabs>

      <Box mt="4">
        {env === null ? (
          (() => {
            // Merged real + pending-from-draft schedules; the "all envs" view
            // mirrors what RuleList builds per-env so pending publish badges
            // surface on rules whose only change is a queued ramp action.
            const allEnvsRampMap = buildRuleRampScheduleMap({
              rampSchedules,
              draftRevision,
            });
            // Roll up per-env unreachability into a single set: a rule is
            // unreachable in the all-envs view iff it's unreachable in *every*
            // env it applies to. Rules with no env footprint
            // (allEnvironments:false, environments:[]) never apply anywhere
            // and are surfaced via the "No environments" badge instead, so
            // they're skipped here rather than marked unreachable.
            const unreachableIdxByEnv = new Map<string, number>();
            for (const e of environments) {
              unreachableIdxByEnv.set(
                e.id,
                getUnreachableRuleIndex(rulesByEnv[e.id] ?? [], experimentsMap),
              );
            }
            const unreachableRuleIds = new Set<string>();
            for (const rule of allEnvItems) {
              const applicable = ruleFootprint(rule, envs);
              if (applicable.length === 0) continue;
              const blockedEverywhere = applicable.every((envId) => {
                const envRules = rulesByEnv[envId] ?? [];
                const idx = envRules.findIndex((r) => r.id === rule.id);
                if (idx === -1) return false;
                const unreachableIdx = unreachableIdxByEnv.get(envId) ?? 0;
                return unreachableIdx > 0 && idx >= unreachableIdx;
              });
              if (blockedEverywhere) unreachableRuleIds.add(rule.id);
            }
            return (
              <>
                {allEnvItems.length > 0 || includeHoldoutRuleAllEnvs ? (
                  <Flex direction="column" gap="4">
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
                              body: JSON.stringify({
                                from: oldIndex,
                                to: newIndex,
                              }),
                            },
                          );
                          await mutate();
                          if (res.version) setVersion(res.version);
                        }
                        setAllEnvDragId(null);
                      }}
                    >
                      {includeHoldoutRuleAllEnvs && (
                        <HoldoutRule
                          feature={
                            draftDeletesHoldoutAnyEnv ? baseFeature : feature
                          }
                          isDeleted={draftDeletesHoldoutAnyEnv}
                          setRuleModal={() => setHoldoutModal(true)}
                          mutate={mutate}
                          revisionList={revisionList}
                          setVersion={setVersion}
                          isLocked={isLocked}
                        />
                      )}
                      <SortableContext
                        items={allEnvItems}
                        strategy={verticalListSortingStrategy}
                      >
                        {allEnvItems.map((rule, allEnvIdx) => {
                          // displayEnv is cosmetic; modal addresses by rule.id.
                          const displayEnv =
                            rule.allEnvironments === true ||
                            !rule.environments?.length
                              ? (environments[0]?.id ?? "")
                              : rule.environments[0];
                          const rampSchedule = allEnvsRampMap.get(rule.id);
                          return (
                            <SortableRule
                              key={rule.id}
                              rule={rule}
                              feature={feature}
                              environment={displayEnv}
                              i={allEnvIdx}
                              mutate={mutate}
                              setRuleModal={setRuleModal}
                              unreachable={unreachableRuleIds.has(rule.id)}
                              version={currentVersion}
                              setVersion={setVersion}
                              locked={isLocked}
                              experimentsMap={experimentsMap}
                              hideInactive={hideInactive}
                              isDraft={isDraft}
                              safeRolloutsMap={safeRolloutsMap}
                              holdout={
                                liveHoldoutActiveAnyEnv ? holdout : undefined
                              }
                              rampSchedule={rampSchedule}
                              draftRevision={draftRevision}
                            />
                          );
                        })}
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
                              const rampSchedule = allEnvsRampMap.get(rule.id);
                              const flatIdx = allEnvItems.findIndex(
                                (r) => r.id === rule.id,
                              );
                              return (
                                <Rule
                                  rule={rule}
                                  feature={feature}
                                  environment={displayEnv}
                                  i={flatIdx}
                                  mutate={mutate}
                                  setRuleModal={setRuleModal}
                                  unreachable={unreachableRuleIds.has(rule.id)}
                                  version={currentVersion}
                                  setVersion={setVersion}
                                  locked={isLocked}
                                  experimentsMap={experimentsMap}
                                  hideInactive={hideInactive}
                                  isDraft={isDraft}
                                  safeRolloutsMap={safeRolloutsMap}
                                  holdout={
                                    liveHoldoutActiveAnyEnv
                                      ? holdout
                                      : undefined
                                  }
                                  rampSchedule={rampSchedule}
                                  draftRevision={draftRevision}
                                />
                              );
                            })()
                          : null}
                      </DragOverlay>
                    </DndContext>
                  </Flex>
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
            );
          })()
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
                  <Text weight="semibold" size="large">
                    Add rule to {activeEnv.id}
                  </Text>
                  <Button
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

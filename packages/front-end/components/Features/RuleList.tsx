import { useEffect, useMemo, useState } from "react";
import { FeatureInterface } from "shared/types/feature";
import { Flex } from "@radix-ui/themes";
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
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  FeatureRule,
  SafeRolloutInterface,
  HoldoutInterface,
  RampScheduleInterface,
} from "shared/validators";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import { ruleFootprint } from "shared/util";
import { buildRuleRampScheduleMap } from "@/services/rampScheduleHelpers";
import { useAuth } from "@/services/auth";
import { getRules, isRuleInactive } from "@/services/features";
import {
  buildConflictBanners,
  ConflictBanner,
  getRuleReachability,
  RuleReachability,
  SavedGroupForConflicts,
} from "@/services/rule-conflicts";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import { Rule, SortableRule } from "./Rule";
import { HoldoutRule } from "./HoldoutRule";

type CommonProps = {
  feature: FeatureInterface;
  baseFeature: FeatureInterface;
  mutate: () => void;
  setRuleModal: (args: {
    environment: string;
    i: number;
    ruleId?: string;
    defaultType?: string;
    mode: "create" | "edit" | "duplicate";
  }) => void;
  version: number;
  setVersion: (version: number) => void;
  locked: boolean;
  // `locked` is due to a pending scheduled publish; ramp controls stay interactive.
  lockedBySchedule?: boolean;
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
  hideInactive?: boolean;
  isDraft: boolean;
  safeRolloutsMap: Map<string, SafeRolloutInterface>;
  holdout: HoldoutInterface | undefined;
  holdoutIsDeleted: boolean;
  openHoldoutModal: () => void;
  revisionList: MinimalFeatureRevisionInterface[];
  rampSchedules?: RampScheduleInterface[];
  draftRevision?: FeatureRevisionInterface | null;
  // The revision the draft is based on — lets us tell an intentional disable
  // (draft changed enabled vs its base) from a stale-inherited one (a rebase
  // would reconcile to live's value).
  baseRevision?: FeatureRevisionInterface | null;
  // allEnvsView visibility filter; reorder still resolves against feature.rules.
  hiddenRuleIds?: Set<string>;
};

type RuleListProps = CommonProps &
  (
    | {
        allEnvsView: true;
        environments: Environment[];
        environment?: undefined;
      }
    | {
        allEnvsView?: false;
        environment: string;
        environments?: undefined;
      }
  );

export default function RuleList(props: RuleListProps) {
  const {
    feature,
    baseFeature,
    mutate,
    setRuleModal,
    version,
    setVersion,
    locked,
    lockedBySchedule,
    experimentsMap,
    hideInactive,
    isDraft,
    safeRolloutsMap,
    holdout,
    holdoutIsDeleted,
    openHoldoutModal,
    revisionList,
    rampSchedules,
    draftRevision,
    baseRevision,
    allEnvsView,
    hiddenRuleIds,
  } = props;

  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const { savedGroups } = useDefinitions();
  const [activeId, setActiveId] = useState<string | null>(null);

  // Saved group definitions for conflict detection. Condition groups carry
  // their `condition` in the definitions payload, but ID-list `values` are
  // stripped from it (for size), so we fetch those lazily below. Until they
  // arrive, a list group is opaque — conflict detection still surfaces soft
  // overlap on its attribute, then upgrades to precise conflicts once values
  // load and this map (and the memos below) recompute.
  const savedGroupDefs = useMemo<Map<string, SavedGroupForConflicts>>(() => {
    const map = new Map<string, SavedGroupForConflicts>();
    for (const g of savedGroups) {
      map.set(g.id, {
        type: g.type,
        attributeKey: g.attributeKey,
        condition: g.condition,
      });
    }
    return map;
  }, [savedGroups]);

  // ID-list saved group ids referenced by this feature's rules (any env).
  const referencedListGroupIds = useMemo<string[]>(() => {
    const ids = new Set<string>();
    for (const r of feature.rules ?? []) {
      for (const sg of r.savedGroups ?? []) {
        for (const id of sg.ids) {
          if (savedGroupDefs.get(id)?.type === "list") ids.add(id);
        }
      }
    }
    return [...ids];
  }, [feature.rules, savedGroupDefs]);

  // Lazily-fetched ID-list values, keyed by saved group id.
  const [listGroupValues, setListGroupValues] = useState<Map<string, string[]>>(
    new Map(),
  );

  useEffect(() => {
    const toFetch = referencedListGroupIds.filter(
      (id) => !listGroupValues.has(id),
    );
    if (!toFetch.length) return;
    let cancelled = false;
    Promise.all(
      toFetch.map((id) =>
        apiCall<{ savedGroup?: { values?: string[] } }>(`/saved-groups/${id}`)
          .then((res) => ({ id, values: res.savedGroup?.values ?? [] }))
          .catch(() => ({ id, values: [] as string[] })),
      ),
    ).then((results) => {
      if (cancelled) return;
      setListGroupValues((prev) => {
        const next = new Map(prev);
        for (const { id, values } of results) next.set(id, values);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [referencedListGroupIds, listGroupValues, apiCall]);

  const savedGroupConflictMap = useMemo<
    Map<string, SavedGroupForConflicts>
  >(() => {
    const map = new Map<string, SavedGroupForConflicts>();
    for (const [id, def] of savedGroupDefs) {
      const values = listGroupValues.get(id);
      map.set(id, values ? { ...def, values } : def);
    }
    return map;
  }, [savedGroupDefs, listGroupValues]);

  // allEnvsView: flat feature.rules narrowed by hiddenRuleIds.
  // single-env: project via getRules to honor env applicability + inheritance.
  const projectItems = (): FeatureRule[] => {
    if (!allEnvsView) return getRules(feature, props.environment);
    const flat = feature.rules ?? [];
    return hiddenRuleIds && hiddenRuleIds.size > 0
      ? flat.filter((r) => !hiddenRuleIds.has(r.id))
      : flat;
  };
  const [items, setItems] = useState<FeatureRule[]>(projectItems);

  useEffect(() => {
    setItems(projectItems());
  }, [
    feature.rules,
    allEnvsView,
    allEnvsView ? null : props.environment,
    hiddenRuleIds,
  ]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Ramp schedules: in single-env mode filter to that env so only rules
  // visible in this projection get pending-publish badges. In all-envs mode
  // we want every pending schedule, regardless of env.
  const rampSchedulesMap = buildRuleRampScheduleMap({
    rampSchedules,
    draftRevision,
    environment: allEnvsView ? undefined : props.environment,
  });

  // Reachability & targeting-conflict detection.
  //   single-env: per-rule analysis of `items` in evaluation order.
  //   all-envs: analyze each environment separately, then group a rule's
  //     environments by the status they share into one banner each — so a rule
  //     unreachable in production but only soft-conflicting in dev shows both,
  //     each naming its environments. Rules with no env footprint never apply
  //     anywhere and are surfaced via the "No environments" badge.
  const reachabilityByRule = useMemo<Map<string, RuleReachability>>(
    () =>
      allEnvsView
        ? new Map()
        : getRuleReachability(items, experimentsMap, savedGroupConflictMap),
    [allEnvsView, items, experimentsMap, savedGroupConflictMap],
  );

  const reachByEnv = useMemo<Map<string, Map<string, RuleReachability>>>(() => {
    const map = new Map<string, Map<string, RuleReachability>>();
    if (!allEnvsView) return map;
    for (const e of props.environments) {
      map.set(
        e.id,
        getRuleReachability(
          getRules(feature, e.id),
          experimentsMap,
          savedGroupConflictMap,
        ),
      );
    }
    return map;
  }, [
    allEnvsView,
    feature,
    experimentsMap,
    props.environments,
    savedGroupConflictMap,
  ]);

  // Per-rule conflict banners. Single-env → at most one banner (env unnamed);
  // all-envs → one banner per status, each naming the environments that share
  // it. The "rule number" shown in the details maps a consuming rule's id to its
  // 1-based position (offset by 1 for the holdout row when present).
  const bannersByRule = useMemo<Map<string, ConflictBanner[]>>(() => {
    const flat = feature.rules ?? [];
    const offset = holdout ? 2 : 1;
    const ruleNumber = (id: string) => {
      const idx = flat.findIndex((r) => r.id === id);
      return idx === -1 ? undefined : idx + offset;
    };
    const out = new Map<string, ConflictBanner[]>();
    if (!allEnvsView) {
      for (const rule of items) {
        const reach = reachabilityByRule.get(rule.id);
        if (!reach) continue;
        out.set(
          rule.id,
          buildConflictBanners(
            [{ env: props.environment, reach }],
            ruleNumber,
            false,
          ),
        );
      }
    } else {
      const envIds = props.environments.map((e) => e.id);
      for (const rule of items) {
        const perEnv = ruleFootprint(rule, envIds)
          .map((env) => ({ env, reach: reachByEnv.get(env)?.get(rule.id) }))
          .filter(
            (x): x is { env: string; reach: RuleReachability } => !!x.reach,
          );
        out.set(rule.id, buildConflictBanners(perEnv, ruleNumber, true));
      }
    }
    return out;
  }, [
    allEnvsView,
    items,
    reachabilityByRule,
    reachByEnv,
    props.environment,
    props.environments,
    feature.rules,
    holdout,
  ]);

  const inactiveRules = items.filter((r) => isRuleInactive(r, experimentsMap));

  if (!items.length && !holdout && !holdoutIsDeleted) {
    return (
      <div className="px-3 mb-3">
        <em>None</em>
      </div>
    );
  }

  function getRuleIndex(id: string) {
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === id) return i;
    }
    return -1;
  }

  // Cosmetic only; the rule modal addresses by rule.id. Single-env passes
  // the active env; all-envs derives a representative env per rule.
  function displayEnvForRule(rule: FeatureRule): string {
    if (!allEnvsView) return props.environment;
    if (rule.allEnvironments === true || !rule.environments?.length) {
      return props.environments[0]?.id ?? "";
    }
    return rule.environments[0];
  }

  // Items-index → feature.rules flat index. Always id-lookup so allEnvsView
  // stays correct when items is filtered.
  function flatIndexOf(ruleId: string, fallback: number) {
    const flat = feature.rules ?? [];
    const idx = flat.findIndex((r) => r.id === ruleId);
    return idx === -1 ? fallback : idx;
  }

  function ruleConflictBanners(ruleId: string): ConflictBanner[] {
    return bannersByRule.get(ruleId) ?? [];
  }

  function isUnreachable(ruleId: string): boolean {
    return ruleConflictBanners(ruleId).some((b) => b.isUnreachable);
  }

  const activeRule = activeId ? items[getRuleIndex(activeId)] : null;

  const canEdit =
    permissionsUtil.canViewFeatureModal(feature.project) &&
    permissionsUtil.canManageFeatureDrafts(feature);

  // Optimistic reorder + flat-index API call. Used by both DnD onDragEnd and
  // the per-rule "Move up/down" menu items, so they share the same translation
  // logic between projection-relative and feature.rules-flat indices.
  async function reorderByRuleId(activeRuleId: string, overRuleId: string) {
    const oldIndex = getRuleIndex(activeRuleId);
    const newIndex = getRuleIndex(overRuleId);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
    const newRules = arrayMove(items, oldIndex, newIndex);
    setItems(newRules);
    const flatOldIndex = flatIndexOf(activeRuleId, oldIndex);
    const flatNewIndex = flatIndexOf(overRuleId, newIndex);
    if (flatOldIndex === -1 || flatNewIndex === -1) return;
    const res = await apiCall<{ version: number }>(
      `/feature/${feature.id}/${version}/reorder`,
      {
        method: "POST",
        body: JSON.stringify({ from: flatOldIndex, to: flatNewIndex }),
      },
    );
    await mutate();
    if (res.version) setVersion(res.version);
  }

  return (
    <Flex direction="column" gap="4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={async ({ active, over }) => {
          if (!canEdit) {
            setActiveId(null);
            return;
          }
          if (over && active.id !== over.id) {
            await reorderByRuleId(active.id as string, over.id as string);
          }
          setActiveId(null);
        }}
        onDragStart={({ active }) => {
          if (!canEdit) {
            return;
          }
          setActiveId(active.id);
        }}
      >
        {inactiveRules.length === items.length && hideInactive && (
          <div className="px-3 mb-3">
            <em>No Active Rules</em>
          </div>
        )}
        {(holdout || holdoutIsDeleted) && (
          <HoldoutRule
            feature={holdoutIsDeleted ? baseFeature : feature}
            isDeleted={holdoutIsDeleted}
            setRuleModal={openHoldoutModal}
            mutate={mutate}
            revisionList={revisionList}
            setVersion={setVersion}
            isLocked={locked}
            currentEnvironment={allEnvsView ? undefined : props.environment}
          />
        )}
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          {items.map((rule, i) => {
            const prevId = i > 0 ? items[i - 1].id : null;
            const nextId = i < items.length - 1 ? items[i + 1].id : null;
            const firstId = items.length > 0 ? items[0].id : null;
            const lastId = items.length > 0 ? items[items.length - 1].id : null;
            // Don't show "move to top" if already at top
            const canMoveToTop = canEdit && i > 0;
            // Don't show "move to bottom" if already at bottom
            const canMoveToBottom = canEdit && i < items.length - 1;
            // Divergence signals for a draft whose base is behind live.
            const draftBehindLive =
              isDraft &&
              (draftRevision?.baseVersion ?? Infinity) < baseFeature.version;
            const liveRule = (baseFeature.rules ?? []).find(
              (r) => r.id === rule.id,
            );
            // Aggressive: the draft intentionally disabled a rule that's enabled
            // in live (the disable is the draft's own change vs its base, not
            // stale-inherited) — publishing really would revert a schedule-driven
            // enable. `baseRevRuleEnabled === false` means the draft inherited the
            // disable, so it would NOT revert.
            const baseRevRuleEnabled = (baseRevision?.rules ?? []).find(
              (r) => r.id === rule.id,
            )?.enabled;
            const willRevertScheduleEnable =
              draftBehindLive &&
              !rule.enabled &&
              !!liveRule?.enabled &&
              baseRevRuleEnabled !== false;
            // Gentle: the draft is behind live and this rule's shown state
            // (enabled or coverage) differs from live for a non-reverting
            // reason — a rebase reconciles it. One message per rule.
            const enabledDiffers =
              draftBehindLive &&
              !!liveRule &&
              !!liveRule.enabled !== !!rule.enabled;
            const coverageDiffers =
              draftBehindLive &&
              rule.type === "rollout" &&
              liveRule?.type === "rollout" &&
              (liveRule.coverage ?? 1) !== (rule.coverage ?? 1);
            const draftBehindLiveStale =
              !willRevertScheduleEnable && (enabledDiffers || coverageDiffers);
            return (
              <SortableRule
                key={rule.id || i}
                environment={displayEnvForRule(rule)}
                i={flatIndexOf(rule.id, i)}
                rule={rule}
                feature={feature}
                mutate={mutate}
                setRuleModal={setRuleModal}
                unreachable={isUnreachable(rule.id)}
                conflictBanners={ruleConflictBanners(rule.id)}
                version={version}
                setVersion={setVersion}
                locked={locked}
                lockedBySchedule={lockedBySchedule}
                experimentsMap={experimentsMap}
                hideInactive={hideInactive}
                isDraft={isDraft}
                safeRolloutsMap={safeRolloutsMap}
                holdout={holdout}
                revisionList={revisionList}
                rampSchedule={rampSchedulesMap.get(rule.id ?? "")}
                draftRevision={draftRevision}
                isAllEnvsView={allEnvsView}
                willRevertScheduleEnable={willRevertScheduleEnable}
                draftBehindLiveStale={draftBehindLiveStale}
                onMoveUp={
                  canEdit && prevId
                    ? () => reorderByRuleId(rule.id, prevId)
                    : undefined
                }
                onMoveDown={
                  canEdit && nextId
                    ? () => reorderByRuleId(rule.id, nextId)
                    : undefined
                }
                onMoveToTop={
                  canMoveToTop && firstId
                    ? () => reorderByRuleId(rule.id, firstId)
                    : undefined
                }
                onMoveToBottom={
                  canMoveToBottom && lastId
                    ? () => reorderByRuleId(rule.id, lastId)
                    : undefined
                }
              />
            );
          })}
        </SortableContext>
        <DragOverlay>
          {activeRule ? (
            <Rule
              i={flatIndexOf(
                activeId as string,
                getRuleIndex(activeId as string),
              )}
              environment={displayEnvForRule(activeRule)}
              rule={activeRule}
              feature={feature}
              mutate={mutate}
              setRuleModal={setRuleModal}
              version={version}
              setVersion={setVersion}
              locked={locked}
              lockedBySchedule={lockedBySchedule}
              experimentsMap={experimentsMap}
              hideInactive={hideInactive}
              unreachable={isUnreachable(activeId as string)}
              conflictBanners={ruleConflictBanners(activeId as string)}
              isDraft={isDraft}
              safeRolloutsMap={safeRolloutsMap}
              holdout={holdout}
              revisionList={revisionList}
              rampSchedule={rampSchedulesMap.get(activeRule.id ?? "")}
              draftRevision={draftRevision}
              isAllEnvsView={allEnvsView}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </Flex>
  );
}

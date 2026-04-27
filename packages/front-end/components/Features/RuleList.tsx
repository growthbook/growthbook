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
import {
  getRules,
  getUnreachableRuleIndex,
  isRuleInactive,
} from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
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
    allEnvsView,
  } = props;

  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const [activeId, setActiveId] = useState<string | null>(null);

  // In allEnvsView the visible items are the flat `feature.rules` array. In
  // single-env mode we project rules through `getRules(feature, env)` to honor
  // env applicability + inheritance.
  const initialItems: FeatureRule[] = allEnvsView
    ? (feature.rules ?? [])
    : getRules(feature, props.environment);
  const [items, setItems] = useState<FeatureRule[]>(initialItems);

  // `getRules` returns a fresh array every call, so depend on the underlying
  // rules array identity + view selector rather than the projection itself.
  useEffect(() => {
    setItems(
      allEnvsView
        ? (feature.rules ?? [])
        : getRules(feature, props.environment),
    );
  }, [feature.rules, allEnvsView, allEnvsView ? null : props.environment]);

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

  // Unreachable detection
  //   single-env: threshold index — every rule at/after `unreachableIndex`
  //     is blocked by an earlier 100% rule.
  //   all-envs: a rule is unreachable iff it's blocked in *every* env it
  //     applies to. Rules with no env footprint (allEnvironments:false,
  //     environments:[]) never apply anywhere, so they're surfaced via the
  //     "No environments" badge instead and skipped here.
  const unreachableIndex = allEnvsView
    ? 0
    : getUnreachableRuleIndex(items, experimentsMap);

  const unreachableRuleIds = useMemo<Set<string>>(() => {
    if (!allEnvsView) return new Set();
    const envIds = props.environments.map((e) => e.id);
    const unreachableIdxByEnv = new Map<string, number>();
    for (const e of props.environments) {
      const envRules = getRules(feature, e.id);
      unreachableIdxByEnv.set(
        e.id,
        getUnreachableRuleIndex(envRules, experimentsMap),
      );
    }
    const out = new Set<string>();
    for (const rule of items) {
      const applicable = ruleFootprint(rule, envIds);
      if (applicable.length === 0) continue;
      const blockedEverywhere = applicable.every((envId) => {
        const envRules = getRules(feature, envId);
        const idx = envRules.findIndex((r) => r.id === rule.id);
        if (idx === -1) return false;
        const threshold = unreachableIdxByEnv.get(envId) ?? 0;
        return threshold > 0 && idx >= threshold;
      });
      if (blockedEverywhere) out.add(rule.id);
    }
    return out;
  }, [allEnvsView, items, feature, experimentsMap, props.environments]);

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

  // In all-envs mode item indices match `feature.rules` indices already.
  function flatIndexOf(ruleId: string, fallback: number) {
    if (allEnvsView) return fallback;
    const flat = feature.rules ?? [];
    return flat.findIndex((r) => r.id === ruleId);
  }

  function isUnreachable(idx: number, ruleId: string): boolean {
    if (allEnvsView) return unreachableRuleIds.has(ruleId);
    return !!unreachableIndex && idx >= unreachableIndex;
  }

  const activeRule = activeId ? items[getRuleIndex(activeId)] : null;

  const canEdit =
    permissionsUtil.canViewFeatureModal(feature.project) &&
    permissionsUtil.canManageFeatureDrafts(feature);

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
            const oldIndex = getRuleIndex(active.id);
            const newIndex = getRuleIndex(over.id);

            if (oldIndex === -1 || newIndex === -1) return;

            const newRules = arrayMove(items, oldIndex, newIndex);
            setItems(newRules);

            const flatOldIndex = flatIndexOf(active.id as string, oldIndex);
            const flatNewIndex = flatIndexOf(over.id as string, newIndex);
            if (flatOldIndex === -1 || flatNewIndex === -1) return;

            const res = await apiCall<{ version: number }>(
              `/feature/${feature.id}/${version}/reorder`,
              {
                method: "POST",
                body: JSON.stringify({
                  from: flatOldIndex,
                  to: flatNewIndex,
                }),
              },
            );
            await mutate();
            res.version && setVersion(res.version);
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
          {items.map((rule, i) => (
            <SortableRule
              key={rule.id || i}
              environment={displayEnvForRule(rule)}
              i={flatIndexOf(rule.id, i)}
              rule={rule}
              feature={feature}
              mutate={mutate}
              setRuleModal={setRuleModal}
              unreachable={isUnreachable(i, rule.id)}
              version={version}
              setVersion={setVersion}
              locked={locked}
              experimentsMap={experimentsMap}
              hideInactive={hideInactive}
              isDraft={isDraft}
              safeRolloutsMap={safeRolloutsMap}
              holdout={holdout}
              rampSchedule={rampSchedulesMap.get(rule.id ?? "")}
              draftRevision={draftRevision}
              isAllEnvsView={allEnvsView}
            />
          ))}
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
              experimentsMap={experimentsMap}
              hideInactive={hideInactive}
              unreachable={isUnreachable(
                getRuleIndex(activeId as string),
                activeId as string,
              )}
              isDraft={isDraft}
              safeRolloutsMap={safeRolloutsMap}
              holdout={holdout}
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

import { useEffect, useState } from "react";
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
  SafeRolloutInterface,
  HoldoutInterface,
  RampScheduleInterface,
} from "shared/validators";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
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

export default function RuleList({
  feature,
  baseFeature,
  mutate,
  environment,
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
}: {
  feature: FeatureInterface;
  baseFeature: FeatureInterface;
  environment: string;
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
}) {
  const { apiCall } = useAuth();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState(getRules(feature, environment));
  const permissionsUtil = usePermissionsUtil();

  // ruleId → global flat index in feature.rules (env-independent).
  const flatIdxById = new Map<string, number>();
  (feature.rules ?? []).forEach((r, idx) => flatIdxById.set(r.id, idx));

  // ruleId → ramp schedule (real or synthetic-pending), scoped to this env.
  const rampSchedulesMap = buildRuleRampScheduleMap({
    rampSchedules,
    draftRevision,
    environment,
  });

  // `getRules` returns a fresh array every call, so depend on the underlying
  // rules array identity + env id rather than the projection itself.
  useEffect(() => {
    setItems(getRules(feature, environment));
  }, [feature.rules, environment]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

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

  // detect unreachable rules, and get the first rule that is at 100%.
  const unreachableIndex = getUnreachableRuleIndex(items, experimentsMap);

  const activeRule = activeId ? items[getRuleIndex(activeId)] : null;

  const canEdit =
    permissionsUtil.canViewFeatureModal(feature.project) &&
    permissionsUtil.canManageFeatureDrafts(feature);

  return (
    <Flex direction="column" gap="5">
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

            // Optimistic update uses env-projected indices; the API call
            // below translates to flat `feature.rules[]` indices.
            const newRules = arrayMove(items, oldIndex, newIndex);
            setItems(newRules);

            const flatRules = feature.rules ?? [];
            const flatOldIndex = flatRules.findIndex(
              (r) => r.id === (active.id as string),
            );
            const flatNewIndex = flatRules.findIndex(
              (r) => r.id === (over.id as string),
            );
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
            currentEnvironment={environment}
          />
        )}
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          {items.map((rule, i) => (
            <SortableRule
              key={i + rule.id}
              environment={environment}
              i={flatIdxById.get(rule.id) ?? -1}
              rule={rule}
              feature={feature}
              mutate={mutate}
              setRuleModal={setRuleModal}
              unreachable={!!unreachableIndex && i >= unreachableIndex}
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
            />
          ))}
        </SortableContext>
        <DragOverlay>
          {activeRule ? (
            <Rule
              i={flatIdxById.get(activeId as string) ?? -1}
              environment={environment}
              rule={activeRule}
              feature={feature}
              mutate={mutate}
              setRuleModal={setRuleModal}
              version={version}
              setVersion={setVersion}
              locked={locked}
              experimentsMap={experimentsMap}
              hideInactive={hideInactive}
              unreachable={
                !!unreachableIndex &&
                getRuleIndex(activeId as string) >= unreachableIndex
              }
              isDraft={isDraft}
              safeRolloutsMap={safeRolloutsMap}
              holdout={holdout}
              rampSchedule={rampSchedulesMap.get(activeRule.id ?? "")}
              draftRevision={draftRevision}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </Flex>
  );
}

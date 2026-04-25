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
  RampScheduleForDisplay,
} from "shared/validators";
import {
  FeatureRevisionInterface,
  MinimalFeatureRevisionInterface,
} from "shared/types/feature-revision";
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

  // Map ruleId → global flat index in feature.rules (env-independent).
  const flatIdxById = new Map<string, number>();
  (feature.rules ?? []).forEach((r, idx) => flatIdxById.set(r.id, idx));

  // ruleId → ramp schedule for O(1) lookup, scoped to this env.
  const rampSchedulesMap = new Map<string, RampScheduleInterface>();

  for (const rs of rampSchedules ?? []) {
    for (const target of rs.targets) {
      if (
        target.ruleId &&
        (!target.environment || target.environment === environment)
      ) {
        if (!rampSchedulesMap.has(target.ruleId)) {
          rampSchedulesMap.set(target.ruleId, rs);
        }
      }
    }
  }

  // Then, add pending ramp schedules from draft actions
  // These are fake/synthetic schedules just for UI display of pending state
  if (draftRevision?.rampActions) {
    for (const action of draftRevision.rampActions) {
      if (
        action.mode === "create" &&
        (!action.environment || action.environment === environment)
      ) {
        // Only add if not already in map (real schedule takes precedence)
        if (!rampSchedulesMap.has(action.ruleId)) {
          // Create a synthetic pending ramp schedule for display
          // This is just for UI - convert action dates (ISO strings) to Date objects
          const pendingRamp: RampScheduleForDisplay = {
            id: `pending-${action.ruleId}`,
            name: action.name ?? "Pending ramp schedule",
            targets: [
              {
                id: "t1",
                entityType: "feature",
                entityId: "",
                ruleId: action.ruleId,
                environment,
                status: "active",
              },
            ],
            steps: action.steps as RampScheduleForDisplay["steps"],
            endActions:
              action.endActions as RampScheduleForDisplay["endActions"],
            startDate: action.startDate
              ? new Date(action.startDate)
              : undefined,
            endCondition:
              action.endCondition?.trigger?.type === "scheduled"
                ? {
                    trigger: {
                      type: "scheduled",
                      at: new Date(action.endCondition.trigger.at),
                    },
                  }
                : undefined,
            status: "pending",
            dateCreated: new Date(),
            dateUpdated: new Date(),
          };
          rampSchedulesMap.set(
            action.ruleId,
            pendingRamp as RampScheduleInterface,
          );
        }
      }
    }
  }

  // `getRules` projects `feature.rules` for the given env, returning a new
  // array every call. Using the returned array as a deep dep churns the
  // effect on every render. Key on the identity of the underlying rules
  // array plus the env id instead — the projection is pure over those two
  // inputs, so it's sufficient for change detection.
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
    <Flex direction="column" gap="3">
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

            // Optimistic UI update uses env-projected indices.
            const newRules = arrayMove(items, oldIndex, newIndex);
            setItems(newRules);

            // API uses flat indices — the backend always operates on
            // feature.rules[] directly and doesn't need the env context.
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
            ruleCount={items.length}
            revisionList={revisionList}
            setVersion={setVersion}
            isLocked={locked}
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

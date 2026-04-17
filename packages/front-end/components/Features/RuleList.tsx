import { useEffect, useState } from "react";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
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
  setCopyRuleModal,
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
    defaultType?: string;
    mode: "create" | "edit" | "duplicate";
  }) => void;
  setCopyRuleModal: (args: {
    environment: string;
    rules: FeatureRule[];
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

  // Build a ruleId → ramp schedule map for this environment so Rule can look
  // up its associated ramp schedule in O(1) without prop drilling the full array.
  const rampSchedulesMap = new Map<string, RampScheduleInterface>();

  // First, add actual ramp schedules
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

  useEffect(() => {
    setItems(getRules(feature, environment));
  }, [getRules(feature, environment)]);

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

            const newRules = arrayMove(items, oldIndex, newIndex);

            setItems(newRules);
            const res = await apiCall<{ version: number }>(
              `/feature/${feature.id}/${version}/reorder`,
              {
                method: "POST",
                body: JSON.stringify({
                  environment,
                  from: oldIndex,
                  to: newIndex,
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
          {items.map(({ ...rule }, i) => (
            <SortableRule
              key={i + rule.id}
              environment={environment}
              i={i}
              rule={rule}
              feature={feature}
              mutate={mutate}
              setRuleModal={setRuleModal}
              setCopyRuleModal={setCopyRuleModal}
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
              i={getRuleIndex(activeId as string)}
              environment={environment}
              rule={activeRule}
              feature={feature}
              mutate={mutate}
              setRuleModal={setRuleModal}
              setCopyRuleModal={setCopyRuleModal}
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

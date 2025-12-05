import { useEffect, useState } from "react";
import { FeatureInterface, FeatureRule } from "back-end/types/feature";
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
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { SafeRolloutInterface } from "back-end/src/validators/safe-rollout";
import { HoldoutInterface } from "shared/validators";
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
  openHoldoutModal,
}: {
  feature: FeatureInterface;
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
  openHoldoutModal: () => void;
}) {
  const { apiCall } = useAuth();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState(getRules(feature, environment));
  const permissionsUtil = usePermissionsUtil();

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

  if (!items.length && !holdout) {
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
    !locked &&
    permissionsUtil.canViewFeatureModal(feature.project) &&
    permissionsUtil.canManageFeatureDrafts(feature);

  return (
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
      {holdout && (
        <HoldoutRule
          feature={feature}
          setRuleModal={openHoldoutModal}
          mutate={mutate}
          ruleCount={items.length}
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
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

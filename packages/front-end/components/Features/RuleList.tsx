import { useEffect, useState } from "react";
import { FeatureInterface } from "back-end/types/feature";
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
import { useAuth } from "@/services/auth";
import { getRules, isRuleFullyCovered } from "@/services/features";
import usePermissions from "@/hooks/usePermissions";
import { Rule, SortableRule } from "./Rule";

export default function RuleList({
  feature,
  mutate,
  experiments,
  environment,
  setRuleModal,
}: {
  feature: FeatureInterface;
  experiments: Record<string, ExperimentInterfaceStringDates>;
  environment: string;
  mutate: () => void;
  setRuleModal: (rule: { environment: string; i: number }) => void;
}) {
  const { apiCall } = useAuth();
  // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'null' is not assignable to param... Remove this comment to see the full error message
  const [activeId, setActiveId] = useState<string>(null);
  const [items, setItems] = useState(getRules(feature, environment));
  const permissions = usePermissions();

  useEffect(() => {
    setItems(getRules(feature, environment));
  }, [getRules(feature, environment)]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  if (!items.length) {
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
  let unreachableIndex = 0;
  items.forEach((item, i) => {
    if (unreachableIndex) return;

    // if this rule covers 100% of traffic, no additional rules are reachable.
    if (isRuleFullyCovered(item)) {
      unreachableIndex = i + 1;
    }
  });

  const activeRule = activeId ? items[getRuleIndex(activeId)] : null;

  const canEdit =
    permissions.check("manageFeatures", feature.project) &&
    permissions.check("createFeatureDrafts", feature.project);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={async ({ active, over }) => {
        if (!canEdit) {
          // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'null' is not assignable to param... Remove this comment to see the full error message
          setActiveId(null);
          return;
        }

        // @ts-expect-error TS(2531) If you come across this, please fix it!: Object is possibly 'null'.
        if (active.id !== over.id) {
          const oldIndex = getRuleIndex(active.id);
          // @ts-expect-error TS(2531) If you come across this, please fix it!: Object is possibly 'null'.
          const newIndex = getRuleIndex(over.id);

          if (oldIndex === -1 || newIndex === -1) return;

          const newRules = arrayMove(items, oldIndex, newIndex);

          setItems(newRules);
          await apiCall(`/feature/${feature.id}/reorder`, {
            method: "POST",
            body: JSON.stringify({
              environment,
              from: oldIndex,
              to: newIndex,
            }),
          });
          mutate();
        }
        // @ts-expect-error TS(2345) If you come across this, please fix it!: Argument of type 'null' is not assignable to param... Remove this comment to see the full error message
        setActiveId(null);
      }}
      onDragStart={({ active }) => {
        if (!canEdit) {
          return;
        }
        setActiveId(active.id);
      }}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {items.map(({ ...rule }, i) => (
          <SortableRule
            key={rule.id}
            environment={environment}
            i={i}
            rule={rule}
            feature={feature}
            mutate={mutate}
            experiments={experiments}
            setRuleModal={setRuleModal}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'null' is not assignable to type 'boolean | u... Remove this comment to see the full error message
            unreachable={unreachableIndex && i >= unreachableIndex}
          />
        ))}
      </SortableContext>
      <DragOverlay>
        {activeRule ? (
          <Rule
            i={getRuleIndex(activeId)}
            environment={environment}
            rule={activeRule}
            feature={feature}
            mutate={mutate}
            experiments={experiments}
            setRuleModal={setRuleModal}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

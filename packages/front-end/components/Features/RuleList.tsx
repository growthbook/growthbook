import { useEffect, useState } from "react";
import { FeatureInterface } from "back-end/types/feature";
import { Rule, SortableRule } from "./Rule";
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
import { useAuth } from "../../services/auth";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { getRules } from "../../services/features";
import { Environment } from "back-end/types/organization";

export default function RuleList({
  feature,
  mutate,
  experiments,
  environment,
  setRuleModal,
  environments,
}: {
  feature: FeatureInterface;
  experiments: Record<string, ExperimentInterfaceStringDates>;
  environment: string;
  mutate: () => void;
  setRuleModal: ({ environment: string, i: number }) => void;
  environments: Environment[];
}) {
  const { apiCall } = useAuth();
  const [activeId, setActiveId] = useState<string>(null);
  const [items, setItems] = useState(getRules(feature, environment));

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

  const activeRule = activeId ? items[getRuleIndex(activeId)] : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={async ({ active, over }) => {
        if (active.id !== over.id) {
          const oldIndex = getRuleIndex(active.id);
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
        setActiveId(null);
      }}
      onDragStart={({ active }) => {
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
            environments={environments}
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
            environments={environments}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

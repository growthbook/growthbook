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
import { getRules } from "@/services/features";
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
  setRuleModal: ({ environment: string, i: number }) => void;
}) {
  const { apiCall } = useAuth();
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
          setActiveId(null);
          return;
        }

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

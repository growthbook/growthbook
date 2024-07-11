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
import { useAuth } from "@/services/auth";
import {
  getRules,
  isRuleDisabled,
  isRuleFullyCovered,
} from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { Rule, SortableRule } from "./Rule";

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
}: {
  feature: FeatureInterface;
  environment: string;
  mutate: () => void;
  setRuleModal: (rule: { environment: string; i: number }) => void;
  setCopyRuleModal: (args: {
    environment: string;
    rules: FeatureRule[];
  }) => void;
  version: number;
  setVersion: (version: number) => void;
  locked: boolean;
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
}) {
  const { apiCall } = useAuth();
  const [hideDisabled, setHideDisabled] = useLocalStorage(
    `hide-disabled-rules-${environment}`,
    false
  );
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
    })
  );
  const showInactiveToggle =
    items.filter((r) => isRuleDisabled(r, experimentsMap)).length > 0;

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

  const filteredItems =
    showInactiveToggle && hideDisabled
      ? items.filter((r) => !isRuleDisabled(r, experimentsMap))
      : items;

  // detect unreachable rules, and get the first rule that is at 100%.
  let unreachableIndex = 0;
  filteredItems.forEach((item, i) => {
    if (unreachableIndex) return;

    // if this rule covers 100% of traffic, no additional rules are reachable.
    if (isRuleFullyCovered(item)) {
      unreachableIndex = i + 1;
    }
  });

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
            }
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
      {showInactiveToggle ? (
        <div className="d-flex justify-content-end p-2">
          <label className="">
            <input
              type="checkbox"
              className="form-check-input"
              checked={hideDisabled}
              onChange={(e) => setHideDisabled(e.target.checked)}
            />
            only show active rules
          </label>
        </div>
      ) : null}
      <SortableContext
        items={filteredItems}
        strategy={verticalListSortingStrategy}
      >
        {filteredItems.map(({ ...rule }, i) => (
          <SortableRule
            key={rule.id}
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
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

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
import { HoldoutInterface } from "back-end/src/routers/holdout/holdout.validators";
import { HoldoutRule } from "back-end/src/validators/features";
import { useAuth } from "@/services/auth";
import {
  getRules,
  getUnreachableRuleIndex,
  isRuleInactive,
} from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useExperiments } from "@/hooks/useExperiments";
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
  hideInactive,
  isDraft,
  safeRolloutsMap,
  holdout,
}: {
  feature: FeatureInterface;
  environment: string;
  mutate: () => void;
  setRuleModal: (args: {
    environment: string;
    i: number;
    defaultType?: string;
    duplicate?: boolean;
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
}) {
  const { apiCall } = useAuth();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState(getRules(feature, environment));
  const permissionsUtil = usePermissionsUtil();

  const { experimentsMap: allExperimentsMap } = useExperiments(
    feature.project,
    false,
    "holdout"
  );

  const holdoutExperiment = holdout
    ? allExperimentsMap.get(holdout.experimentId)
    : undefined;

  // TODO: generate holdout rule if holdout is defined and environment is in holdout.environments
  const holdoutRule: HoldoutRule | null =
    holdout && holdoutExperiment && holdout.environments.includes(environment)
      ? {
          id: "holdout",
          description: holdout.name,
          type: "holdout",
          value: feature.holdout?.value || "",
          condition: holdoutExperiment.phases[0].condition,
          savedGroups: holdoutExperiment.phases[0].savedGroups,
          prerequisites: holdoutExperiment.phases[0].prerequisites,
          coverage:
            holdoutExperiment?.phases[0].coverage *
            holdoutExperiment?.phases[0].variationWeights[0],
          hashAttribute: holdoutExperiment.hashAttribute,
          enabled: true,
        }
      : null;

  useEffect(() => {
    setItems(getRules(feature, environment));
  }, [getRules(feature, environment)]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const inactiveRules = items.filter((r) => isRuleInactive(r, experimentsMap));

  if (!items.length && !holdoutRule) {
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
      {inactiveRules.length === items.length && hideInactive && (
        <div className="px-3 mb-3">
          <em>No Active Rules</em>
        </div>
      )}
      {/* TODO: Add holdout rule above the other rules if feature.holdout is defined */}
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {holdoutRule && (
          <SortableRule
            key="holdout-rule"
            environment={environment}
            i={0}
            rule={holdoutRule}
            feature={feature}
            mutate={mutate}
            setRuleModal={setRuleModal}
            setCopyRuleModal={setCopyRuleModal}
            unreachable={false}
            version={version}
            setVersion={setVersion}
            locked={locked}
            experimentsMap={experimentsMap}
            hideInactive={hideInactive}
            isDraft={isDraft}
            safeRolloutsMap={safeRolloutsMap}
          />
        )}
        {items.map(({ ...rule }, i) => (
          <SortableRule
            key={i + rule.id}
            environment={environment}
            i={holdoutRule ? i + 1 : i}
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
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

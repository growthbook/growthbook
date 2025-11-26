import { useState, useMemo, useEffect } from "react";
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
import { Environment } from "back-end/types/organization";
import { Box, Flex, Text } from "@radix-ui/themes";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { getUnreachableRuleIndex, isRuleInactive } from "@/services/features";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import PremiumCallout from "@/ui/PremiumCallout";
import track from "@/services/track";
import { HoldoutRule } from "./HoldoutRule";
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
  openHoldoutModal,
  canEditDrafts,
  isSafeRolloutPromoEnabled,
  hasSafeRollout,
  environments,
}: {
  feature: FeatureInterface;
  environment: string; // empty string "" means all environments, otherwise specific environment id
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
  canEditDrafts: boolean;
  isSafeRolloutPromoEnabled: boolean;
  hasSafeRollout: boolean;
  environments: Environment[];
}) {
  const { apiCall } = useAuth();
  const [activeId, setActiveId] = useState<string | null>(null);
  const permissionsUtil = usePermissionsUtil();

  // Get all rules - filtering happens during render
  const allRules = feature?.rules ?? [];

  // Compute filtered items for drag-and-drop (needs stable array)
  // This is used for the SortableContext items array
  const filteredItems = useMemo(() => {
    if (environment === "") {
      return allRules;
    }
    return allRules.filter(
      (rule) =>
        rule.allEnvironments || rule.environments?.includes(environment),
    );
  }, [allRules, environment]);

  // Use state for drag-and-drop reordering (optimistic updates)
  const [items, setItems] = useState(filteredItems);

  // Update items when filtered items change (but not during drag)
  useEffect(() => {
    setItems(filteredItems);
  }, [filteredItems]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const inactiveRules = items.filter((r) => isRuleInactive(r, experimentsMap));

  // Check if holdout rule should be included
  // Show in "All Rules" tab (environment === "") or if enabled for the current environment
  const currentEnv =
    environment === "" ? null : environments.find((e) => e.id === environment);
  const includeHoldoutRule =
    !!holdout &&
    (environment === "" ||
      (currentEnv && !!holdout?.environmentSettings?.[currentEnv.id]?.enabled));

  const canEdit =
    !locked &&
    permissionsUtil.canViewFeatureModal(feature.project) &&
    permissionsUtil.canManageFeatureDrafts(feature);

  // Early return for empty state
  if (!items.length && !includeHoldoutRule) {
    return (
      <div className="mt-2">
        <Box py="4" className="text-muted">
          <em>
            {environment === ""
              ? "No rules have been added yet"
              : "No rules have been added to this environment yet"}
          </em>
        </Box>

        {canEditDrafts && !locked && (
          <>
            <Flex pt="4" justify="between" align="center">
              <Text weight="bold" size="3">
                {environment === "" ? "Add rule" : `Add rule to ${environment}`}
              </Text>
              <Button
                onClick={() => {
                  setRuleModal({
                    environment:
                      environment === ""
                        ? environments[0]?.id || ""
                        : environment,
                    i: items.length,
                    mode: "create",
                  });
                  track("Viewed Rule Modal", {
                    source: "add-rule",
                    type: "force",
                  });
                }}
              >
                Add Rule
              </Button>
            </Flex>
            {isSafeRolloutPromoEnabled && !hasSafeRollout ? (
              <PremiumCallout
                id="feature-rules-add-rule"
                commercialFeature="safe-rollout"
                mt="5"
              >
                <Flex direction="row" gap="3">
                  <Text>
                    <strong>Safe Rollouts</strong> can be used to release new
                    values while monitoring for errors.
                  </Text>
                </Flex>
              </PremiumCallout>
            ) : isSafeRolloutPromoEnabled && hasSafeRollout ? (
              <Callout
                mt="5"
                status="info"
                icon={<Badge label="NEW!" />}
                dismissible
                id="safe-rollout-promo"
              >
                Use <strong>Safe Rollouts</strong> to test for guardrail errors
                while releasing a new value. Click &lsquo;Add Rule&rsquo; to get
                started.
              </Callout>
            ) : null}
          </>
        )}
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

  console.log({ environment });

  return (
    <div className="mt-2">
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
        {includeHoldoutRule && holdout ? (
          <HoldoutRule
            feature={feature}
            setRuleModal={openHoldoutModal}
            mutate={mutate}
            ruleCount={items.length}
          />
        ) : null}
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          {allRules.map((rule, i) => {
            // Filter: return null if rule doesn't match current environment
            if (environment !== "") {
              if (
                !rule.allEnvironments &&
                !rule.environments?.includes(environment)
              ) {
                return null;
              }
            }

            // Find the index in the filtered items array for this rule
            const filteredIndex = items.findIndex((r) => r.uid === rule.uid);
            if (filteredIndex === -1) return null;

            return (
              <SortableRule
                key={rule.uid || i + rule.id}
                environment={environment}
                i={filteredIndex}
                rule={rule}
                feature={feature}
                mutate={mutate}
                setRuleModal={setRuleModal}
                setCopyRuleModal={setCopyRuleModal}
                unreachable={
                  !!unreachableIndex && filteredIndex >= unreachableIndex
                }
                version={version}
                setVersion={setVersion}
                locked={locked}
                experimentsMap={experimentsMap}
                hideInactive={hideInactive}
                isDraft={isDraft}
                safeRolloutsMap={safeRolloutsMap}
                holdout={holdout}
              />
            );
          })}
        </SortableContext>
        <DragOverlay>
          {activeRule ? (
            <Rule
              i={getRuleIndex(activeId as string)}
              environment={environment || ""}
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

      {canEditDrafts && !locked && (
        <>
          <Flex pt="4" justify="between" align="center">
            <Text weight="bold" size="3">
              {environment === "" ? "Add rule" : `Add rule to ${environment}`}
            </Text>
            <Button
              onClick={() => {
                setRuleModal({
                  environment:
                    environment === ""
                      ? environments[0]?.id || ""
                      : environment,
                  i: items.length,
                  mode: "create",
                });
                track("Viewed Rule Modal", {
                  source: "add-rule",
                  type: "force",
                });
              }}
            >
              Add Rule
            </Button>
          </Flex>
          {/* TODO: This if/else should be handled by PremiumCallout component */}
          {isSafeRolloutPromoEnabled && !hasSafeRollout ? (
            <PremiumCallout
              id="feature-rules-add-rule"
              commercialFeature="safe-rollout"
              mt="5"
            >
              <Flex direction="row" gap="3">
                <Text>
                  <strong>Safe Rollouts</strong> can be used to release new
                  values while monitoring for errors.
                </Text>
              </Flex>
            </PremiumCallout>
          ) : isSafeRolloutPromoEnabled && hasSafeRollout ? (
            <Callout
              mt="5"
              status="info"
              icon={<Badge label="NEW!" />}
              dismissible
              id="safe-rollout-promo"
            >
              Use <strong>Safe Rollouts</strong> to test for guardrail errors
              while releasing a new value. Click &lsquo;Add Rule&rsquo; to get
              started.
            </Callout>
          ) : null}
        </>
      )}
    </div>
  );
}

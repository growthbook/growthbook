import React from "react";
import { Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { ExplorationConfig, FunnelDataset } from "shared/validators";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { createEmptyFunnelStep } from "@/enterprise/components/ProductAnalytics/util";
import FunnelStepCard from "./FunnelStepCard";

export default function FunnelTabContent() {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();

  if (draftExploreState.dataset?.type !== "funnel") return null;
  const dataset = draftExploreState.dataset;
  const steps = dataset.steps;

  const handleAddStep = () => {
    setDraftExploreState((prev) => {
      if (prev.dataset.type !== "funnel") return prev;
      const previousFactTable =
        prev.dataset.steps[prev.dataset.steps.length - 1]?.factTable ?? "";
      // Default the new step's fact table to the previous step's — the most
      // common case. The picker is hidden on inherited steps, so the user
      // doesn't see a redundant select until they actively want to override.
      const newStep = createEmptyFunnelStep({
        name: `Step ${prev.dataset.steps.length + 1}`,
        factTable: previousFactTable,
      });
      return {
        ...prev,
        dataset: {
          ...prev.dataset,
          steps: [...prev.dataset.steps, newStep],
        } as FunnelDataset,
      } as ExplorationConfig;
    });
  };

  return (
    <Flex direction="column" gap="4">
      {steps.length < 2 && (
        <Flex
          justify="center"
          align="center"
          style={{
            border: "1px solid var(--gray-a3)",
            borderRadius: "var(--radius-3)",
            padding: "var(--space-3)",
            backgroundColor: "var(--color-panel-translucent)",
          }}
        >
          <Text size="small" color="text-low">
            Funnels need at least two steps to run.
          </Text>
        </Flex>
      )}
      {steps.map((step, index) => (
        <FunnelStepCard
          key={index}
          index={index}
          step={step}
          steps={steps}
          previousFactTable={
            index === 0 ? null : (steps[index - 1]?.factTable ?? null)
          }
        />
      ))}
      <Button size="sm" variant="outline" onClick={handleAddStep}>
        <Flex align="center" gap="2">
          <PiPlus size={14} />
          Add step
        </Flex>
      </Button>
    </Flex>
  );
}

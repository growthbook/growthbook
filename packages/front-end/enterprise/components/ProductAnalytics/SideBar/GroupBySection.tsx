import { useMemo } from "react";
import type {
  ExplorationConfig,
  ProductAnalyticsDimension,
  ProductAnalyticsDynamicDimension,
} from "shared/validators";
import { getMaxDimensions } from "@/enterprise/components/ProductAnalytics/util";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import GroupBySectionBase from "./GroupBySectionBase";

export default function GroupBySection() {
  const { draftExploreState, setDraftExploreState, commonColumns } =
    useExplorerContext();
  const dynamicDimensions = useMemo(
    () =>
      draftExploreState.dimensions.filter(
        (dim): dim is ProductAnalyticsDynamicDimension =>
          dim.dimensionType === "dynamic",
      ),
    [draftExploreState.dimensions],
  );

  const nonDynamicDimensions = useMemo(
    () =>
      draftExploreState.dimensions.filter(
        (dim) => dim.dimensionType !== "dynamic",
      ),
    [draftExploreState.dimensions],
  );

  const maxDynamicDimensions = Math.max(
    getMaxDimensions(draftExploreState.dataset) - nonDynamicDimensions.length,
    0,
  );

  const setDynamicDimensions = (
    nextDynamicDimensions: ProductAnalyticsDynamicDimension[],
  ) => {
    setDraftExploreState((prev): ExplorationConfig => {
      const merged: ProductAnalyticsDimension[] = [];
      let dynamicIndex = 0;
      for (const dimension of prev.dimensions) {
        if (dimension.dimensionType !== "dynamic") {
          merged.push(dimension);
          continue;
        }

        const replacement = nextDynamicDimensions[dynamicIndex++];
        if (replacement) {
          merged.push(replacement);
        }
      }

      while (dynamicIndex < nextDynamicDimensions.length) {
        merged.push(nextDynamicDimensions[dynamicIndex++]);
      }

      return {
        ...prev,
        dimensions: merged,
      };
    });
  };

  return (
    <GroupBySectionBase
      dimensions={dynamicDimensions}
      setDimensions={setDynamicDimensions}
      columns={commonColumns}
      maxDimensions={maxDynamicDimensions}
      disableAdd={draftExploreState.chartType === "bigNumber"}
    />
  );
}

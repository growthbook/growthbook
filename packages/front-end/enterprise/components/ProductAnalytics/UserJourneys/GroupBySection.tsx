import { useMemo } from "react";
import type {
  ProductAnalyticsDynamicDimension,
  UserJourneyConfig,
} from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import GroupBySectionBase from "@/enterprise/components/ProductAnalytics/SideBar/GroupBySectionBase";
import { useUserJourneyContext } from "./UserJourneyContext";

export default function UserJourneyGroupBySection() {
  const { draftUserJourneyState, setDraftUserJourneyState } =
    useUserJourneyContext();
  const { getFactTableById } = useDefinitions();

  const dimensions = useMemo(
    () => draftUserJourneyState.dimensions ?? [],
    [draftUserJourneyState.dimensions],
  );
  const dynamicDimensions = useMemo(
    () =>
      dimensions.filter(
        (dim): dim is ProductAnalyticsDynamicDimension =>
          dim.dimensionType === "dynamic",
      ),
    [dimensions],
  );
  const nonDynamicDimensions = useMemo(
    () => dimensions.filter((dim) => dim.dimensionType !== "dynamic"),
    [dimensions],
  );

  const factTable = draftUserJourneyState.factTableId
    ? getFactTableById(draftUserJourneyState.factTableId)
    : null;

  const columns = useMemo(() => {
    if (!factTable) return [];
    return factTable.columns
      .filter((column) => !column.deleted)
      .map((column) => ({
        column: column.column,
        name: column.name,
      }));
  }, [factTable]);

  const maxDynamicDimensions = Math.max(1 - nonDynamicDimensions.length, 0);

  const setDynamicDimensions = (
    nextDynamicDimensions: ProductAnalyticsDynamicDimension[],
  ) => {
    setDraftUserJourneyState((prev): UserJourneyConfig => {
      const prevDimensions = prev.dimensions ?? [];
      type UserJourneyDimension = NonNullable<
        UserJourneyConfig["dimensions"]
      >[number];
      const merged: UserJourneyDimension[] = [];
      let dynamicIndex = 0;
      for (const dimension of prevDimensions) {
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
      columns={columns}
      maxDimensions={maxDynamicDimensions}
      disableAdd={!factTable}
    />
  );
}

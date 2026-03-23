import { Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { useMemo } from "react";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import { ExplorerRowFilterInput } from "@/enterprise/components/ProductAnalytics/SideBar/ExplorerRowFilterInput";
import { factTableToColumnSource } from "@/enterprise/components/ProductAnalytics/SideBar/ExplorerFilterRow";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUserJourneyContext } from "./UserJourneyContext";

export default function GlobalFiltersSection() {
  const { draftUserJourneyState, setDraftUserJourneyState } =
    useUserJourneyContext();
  const { getFactTableById } = useDefinitions();

  const factTable = draftUserJourneyState.factTableId
    ? getFactTableById(draftUserJourneyState.factTableId)
    : null;
  const columnSource = useMemo(() => {
    if (!factTable) return null;
    return factTableToColumnSource(factTable);
  }, [factTable]);

  return (
    <Flex
      direction="column"
      gap="2"
      p="3"
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-4)",
        backgroundColor: "var(--color-panel-translucent)",
      }}
    >
      <Flex justify="between" align="center">
        <Text weight="medium">Global Filters</Text>
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            setDraftUserJourneyState((prev) => ({
              ...prev,
              globalFilters: [
                ...prev.globalFilters,
                { column: "", operator: "=", values: [] },
              ],
            }))
          }
        >
          <Flex align="center" gap="2">
            <PiPlus size={14} /> Add
          </Flex>
        </Button>
      </Flex>
      {columnSource && draftUserJourneyState.globalFilters.length > 0 ? (
        <ExplorerRowFilterInput
          columnSource={columnSource}
          value={draftUserJourneyState.globalFilters}
          setValue={(value) =>
            setDraftUserJourneyState((prev) => ({
              ...prev,
              globalFilters: value,
            }))
          }
        />
      ) : null}
    </Flex>
  );
}

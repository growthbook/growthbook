import { Flex } from "@radix-ui/themes";
import { ShowAs } from "shared/validators";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  getEffectiveShowAs,
  getSharedUnit,
} from "@/enterprise/components/ProductAnalytics/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import Text from "@/ui/Text";
import RadioGroup from "@/ui/RadioGroup";

export default function ShowAsSection() {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();
  const { getFactMetricById } = useDefinitions();

  const value: ShowAs = getEffectiveShowAs(
    draftExploreState,
    getFactMetricById,
  );
  const sharedUnit = getSharedUnit(draftExploreState);
  const perUnitLabel = sharedUnit ? `Per ${sharedUnit}` : "Per Unit";

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
      <Text weight="medium">Show As</Text>
      <RadioGroup
        options={[
          { label: "Event Totals", value: "total" },
          { label: perUnitLabel, value: "per_unit" },
        ]}
        value={value}
        setValue={(v) =>
          setDraftExploreState((prev) => ({
            ...prev,
            showAs: v as ShowAs,
          }))
        }
      />
    </Flex>
  );
}

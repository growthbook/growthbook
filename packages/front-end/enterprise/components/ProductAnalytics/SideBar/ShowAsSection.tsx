import { Flex } from "@radix-ui/themes";
import { ShowAs } from "shared/validators";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import Text from "@/ui/Text";
import RadioGroup from "@/ui/RadioGroup";

export default function ShowAsSection() {
  const { draftExploreState, setDraftExploreState } = useExplorerContext();
  const value: ShowAs = draftExploreState.showAs ?? "total";

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
          { label: "Per Unit", value: "per_unit" },
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

import { Flex } from "@radix-ui/themes";
import QuickEditButton from "@/components/Experiment/TabbedPage/QuickEditButton";
import Metadata from "./Metadata";

export default function MetadataStories() {
  return (
    <Flex direction="column" gap="4">
      <Flex gap="3">
        <Metadata label="Small" value="Data" size="sm" />
        <Metadata label="Medium" value="Data" size="md" />
      </Flex>
      <Flex direction="column" gap="2" width="240px">
        <Metadata label="Stacked" value="Data" size="sm" stacked />
        <Metadata
          label="Stacked, with an action"
          value="Hover the row to reveal its pencil"
          size="sm"
          stacked
          action={
            <QuickEditButton
              label="Edit"
              onClick={() => alert("Edit")}
              labelTooltip={false}
            />
          }
        />
      </Flex>
    </Flex>
  );
}

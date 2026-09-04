import { Flex } from "@radix-ui/themes";
import Frame from "@/ui/Frame";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import DataList, { DataListItem } from "@/ui/DataList";

// Visual shell only - no backend query, no live sample rows, so the
// Preview/SQL toggle has nothing to switch between yet. Matches the design's
// two-button layout without wiring state for content that doesn't exist.
export default function PreviewPanel() {
  return (
    <Frame>
      <Flex justify="between" align="center" mb="3">
        <Heading as="h4" size="sm">
          Preview
        </Heading>
        <Flex gap="1">
          <Button size="sm" variant="solid">
            Preview
          </Button>
          <Button size="sm" variant="outline">
            SQL
          </Button>
        </Flex>
      </Flex>
      <Text color="text-mid" as="div">
        Finish the metric definition to see a preview.
      </Text>
    </Frame>
  );
}

export function MetricDetailsPanel({ data }: { data: DataListItem[] }) {
  return (
    <Frame>
      <Heading as="h4" size="sm" mb="3">
        Details
      </Heading>
      <DataList data={data} columns={1} />
    </Frame>
  );
}

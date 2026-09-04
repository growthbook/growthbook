import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import Frame from "@/ui/Frame";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import DataList, { DataListItem } from "@/ui/DataList";

// Visual shell only - no backend query, no live sample rows. metricformfields.md
// excludes this panel's logic from spec, so there is nothing to wire up yet.
export default function PreviewPanel() {
  const [tab, setTab] = useState<"preview" | "sql">("preview");

  return (
    <Frame>
      <Flex justify="between" align="center" mb="3">
        <Heading as="h4" size="sm">
          Preview
        </Heading>
        <Flex gap="1">
          <Button
            size="sm"
            variant={tab === "preview" ? "solid" : "outline"}
            onClick={() => setTab("preview")}
          >
            Preview
          </Button>
          <Button
            size="sm"
            variant={tab === "sql" ? "solid" : "outline"}
            onClick={() => setTab("sql")}
          >
            SQL
          </Button>
        </Flex>
      </Flex>
      <Text color="text-mid" as="div">
        {tab === "preview"
          ? "Finish the metric definition to see a preview."
          : "Finish the metric definition to see the generated SQL."}
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

import { useState } from "react";
import { Box, Card, Flex, Separator } from "@radix-ui/themes";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { FactTableDefinition } from "shared/types/fact-table";
import DataSourceLogo from "@/components/DataSources/DataSourceLogo";
import AddLlmTracingModal from "@/components/Settings/EditDataSource/AddLlmTracingModal";
import {
  formatLlmTracingAddedDetail,
  getLlmTracingAddedAt,
  getLlmTracingProjectScope,
  getLlmTracingReadsLabel,
  getLlmTracingTools,
  isLlmTracingFormat,
  isLlmTracingToolAdded,
  LlmTracingFormat,
} from "@/services/llmTracing";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import PermissionBlocker from "@/ui/PermissionBlocker";
import Text from "@/ui/Text";

export default function LlmTracingSettings({
  dataSource,
  factTables,
  canEdit,
  onOpenTab,
  onRefresh,
}: {
  dataSource: DataSourceInterfaceWithParams;
  factTables: FactTableDefinition[];
  canEdit: boolean;
  onOpenTab: (tab: "queries" | "resources") => void;
  onRefresh: () => Promise<void>;
}) {
  const tools = getLlmTracingTools(dataSource);
  const [adding, setAdding] = useState<LlmTracingFormat | null>(null);

  if (tools.length === 0) return null;

  const rows = tools.flatMap((tool) => {
    if (!isLlmTracingFormat(tool.value)) return [];
    const format = tool.value;
    const added = isLlmTracingToolAdded({
      datasource: dataSource,
      tool: format,
      factTables,
    });
    return [{ tool, format, added }];
  });
  const anyAdded = rows.some((row) => row.added);
  const anyMissing = rows.some((row) => !row.added);

  return (
    <Frame mb="0">
      <Heading as="h3" size="md" mb="2">
        LLM Tracing
      </Heading>
      <Text as="p" color="text-mid" mb="3">
        {anyMissing
          ? "Measure LLM features in experiments using traces from an LLM tracing tool."
          : "Traces from the tools below are set up for use in experiments."}
      </Text>

      <Card style={{ padding: 0 }}>
        {rows.map(({ tool, format, added }, index) => {
          const scope = getLlmTracingProjectScope(
            format,
            dataSource.settings?.schemaOptions,
          );
          return (
            <Box key={tool.value}>
              {index > 0 ? <Separator size="4" /> : null}
              <Flex align="center" justify="between" gap="3" px="3" py="3">
                <Flex align="center" gap="3" minWidth="0">
                  <DataSourceLogo
                    eventTracker={tool.value}
                    showLabel={false}
                    size={28}
                  />
                  <Box minWidth="0">
                    <Flex align="center" gap="2">
                      <Text weight="medium">{tool.label}</Text>
                      {tool.beta && (
                        <Badge
                          label="Beta"
                          color="indigo"
                          variant="solid"
                          size="xs"
                        />
                      )}
                    </Flex>
                    <Text as="div" size="sm" color="text-mid">
                      {added
                        ? formatLlmTracingAddedDetail(
                            getLlmTracingAddedAt(
                              dataSource.id,
                              format,
                              factTables,
                            ),
                            scope,
                          )
                        : getLlmTracingReadsLabel(format)}
                    </Text>
                  </Box>
                </Flex>
                {added ? (
                  <Box flexShrink="0">
                    <HelperText status="success">Added</HelperText>
                  </Box>
                ) : canEdit ? (
                  <Button variant="soft" onClick={() => setAdding(format)}>
                    {`Add ${tool.label}`}
                  </Button>
                ) : (
                  <Box flexShrink="0">
                    <PermissionBlocker>
                      You don&apos;t have permission to add it.
                    </PermissionBlocker>
                  </Box>
                )}
              </Flex>
            </Box>
          );
        })}
      </Card>

      {anyAdded && (
        <Text as="p" size="sm" color="text-mid" mt="3" mb="0">
          {anyMissing
            ? "For added tools, identifier types, assignment queries, and a join are on the "
            : "Identifier types, assignment queries, and a join are on the "}
          <Link onClick={() => onOpenTab("queries")}>Queries</Link>
          {" tab. Fact tables and starter Fact Metrics are under "}
          <Link onClick={() => onOpenTab("resources")}>
            Connected Resources
          </Link>
          .
        </Text>
      )}

      {adding && (
        <AddLlmTracingModal
          datasource={dataSource}
          template={adding}
          close={() => setAdding(null)}
          onAdded={onRefresh}
        />
      )}
    </Frame>
  );
}

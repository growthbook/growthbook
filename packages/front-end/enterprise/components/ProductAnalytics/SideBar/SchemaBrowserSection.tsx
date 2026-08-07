import { Box, Flex } from "@radix-ui/themes";
import SchemaBrowser from "@/components/SchemaBrowser/SchemaBrowser";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { useSqlEditorContext } from "@/enterprise/components/ProductAnalytics/SqlEditorContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import Text from "@/ui/Text";

export default function SchemaBrowserSection({
  fullHeight = false,
}: {
  fullHeight?: boolean;
}) {
  const { draftExploreState } = useExplorerContext();
  const { getDatasourceById } = useDefinitions();
  const { cursorData, localSql, setLocalSql } = useSqlEditorContext();
  const datasource = getDatasourceById(draftExploreState.datasource);

  if (!datasource) return null;

  const browser = (
    <Box
      mt="2"
      height={fullHeight ? "100%" : "600px"}
      style={{
        flex: fullHeight ? 1 : undefined,
        minHeight: 0,
        maxHeight: fullHeight ? undefined : "calc(100vh - 240px)",
        overflow: "hidden",
      }}
    >
      <SchemaBrowser
        datasource={datasource}
        cursorData={cursorData ?? undefined}
        updateSqlInput={(sql) => {
          if (sql !== localSql) {
            setLocalSql(sql);
          }
        }}
      />
    </Box>
  );

  return (
    <Box
      style={{
        display: "flex",
        flex: fullHeight ? 1 : undefined,
        flexDirection: "column",
        minHeight: 0,
        height: fullHeight ? "100%" : undefined,
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-3)",
        padding: "var(--space-3)",
        backgroundColor: "var(--color-panel-translucent)",
      }}
    >
      <Flex align="center" gap="2" style={{ minWidth: 0 }}>
        <Text weight="medium">Schema Browser</Text>
      </Flex>
      {browser}
    </Box>
  );
}

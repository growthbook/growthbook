import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
import Collapsible from "react-collapsible";
import SchemaBrowser from "@/components/SchemaBrowser/SchemaBrowser";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import { useSqlEditorContext } from "@/enterprise/components/ProductAnalytics/SqlEditorContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/ui/Button";
import Text from "@/ui/Text";

export default function SchemaBrowserSection() {
  const { draftExploreState } = useExplorerContext();
  const { getDatasourceById } = useDefinitions();
  const {
    cursorData,
    localSql,
    schemaCollapsed,
    setLocalSql,
    setSchemaCollapsed,
  } = useSqlEditorContext();
  const datasource = getDatasourceById(draftExploreState.datasource);

  if (!datasource) return null;

  return (
    <Box
      style={{
        border: "1px solid var(--gray-a3)",
        borderRadius: "var(--radius-3)",
        padding: "var(--space-3)",
        backgroundColor: "var(--color-panel-translucent)",
      }}
    >
      <Flex justify="between" align="center">
        <Flex align="center" gap="2" style={{ minWidth: 0, flex: 1 }}>
          <Text weight="medium">Schema Browser</Text>
        </Flex>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setSchemaCollapsed(!schemaCollapsed)}
          title={schemaCollapsed ? "Expand" : "Collapse"}
        >
          {schemaCollapsed ? (
            <PiCaretDown size={14} />
          ) : (
            <PiCaretUp size={14} />
          )}
        </Button>
      </Flex>
      <Collapsible
        open={!schemaCollapsed}
        trigger=""
        triggerDisabled
        transitionTime={100}
      >
        <Box
          mt="2"
          height="600px"
          style={{
            minHeight: 0,
            maxHeight: "calc(100vh - 240px)",
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
      </Collapsible>
    </Box>
  );
}

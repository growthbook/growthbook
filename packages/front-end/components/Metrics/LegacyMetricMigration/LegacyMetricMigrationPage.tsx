import { FC, useCallback } from "react";
import { Flex } from "@radix-ui/themes";
import { useDefinitions } from "@/services/DefinitionsContext";
import Checkbox from "@/ui/Checkbox";
import Button from "@/ui/Button";
import { useMigrationState } from "./useMigrationState";
import FactTableSection from "./FactTableSection";
import UnconvertedSection from "./UnconvertedSection";

const LegacyMetricMigrationPage: FC = () => {
  const { metrics } = useDefinitions();
  const state = useMigrationState(metrics);

  const handleMigrate = useCallback(() => {
    const selected = state.getSelectedMigration();
    console.log("Migration selection:", selected);
  }, [state]);

  if (metrics.length === 0) {
    return (
      <div className="container pagecontents">
        <h1>Legacy Metric Migration</h1>
        <p>No legacy metrics found.</p>
      </div>
    );
  }

  const hasSelection =
    state.selectAllState === true || state.selectAllState === "indeterminate";

  return (
    <div className="container pagecontents">
      <h1>Legacy Metric Migration</h1>
      <p>
        Preview and select which legacy metrics to convert to use Fact Tables.
      </p>

      <Flex
        align="center"
        justify="between"
        mb="4"
        p="3"
        style={{
          position: "sticky",
          top: 56,
          zIndex: 10,
          background: "var(--surface-background-color)",
          borderBottom: "1px solid var(--border-color-200)",
        }}
      >
        <Flex align="center" gap="3">
          <Checkbox
            label="Select All"
            value={state.selectAllState}
            setValue={() => state.toggleSelectAll()}
          />
          <span style={{ fontSize: 13, color: "var(--text-color-muted)" }}>
            ({state.selectedCount} of {state.totalCount} selected)
          </span>
        </Flex>
        <Button onClick={handleMigrate} disabled={!hasSelection}>
          Migrate Selected
        </Button>
      </Flex>

      <h3>Fact Tables</h3>
      {state.result.factTables.map((ft) => {
        const factMetrics = state.factMetricsByTable.get(ft.id) || [];
        return (
          <FactTableSection
            key={ft.id}
            factTable={ft}
            factTableName={state.factTableNames.get(ft.id) || ft.name}
            factMetrics={factMetrics}
            legacyMetricById={state.legacyMetricById}
            checked={state.sectionCheckState(ft.id)}
            sectionEnabled={state.enabledFactTableIds.has(ft.id)}
            disabledMetricIds={state.disabledMetricIds}
            onToggleSection={() => state.toggleFactTable(ft.id)}
            onToggleMetric={(id) => state.toggleMetric(id)}
            onRenameFactTable={(name) => state.renameFactTable(ft.id, name)}
          />
        );
      })}

      <UnconvertedSection items={state.result.unconverted} />
    </div>
  );
};

export default LegacyMetricMigrationPage;

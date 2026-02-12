import { FC, useState } from "react";
import { Flex, Box } from "@radix-ui/themes";
import { FaArrowRight, FaExternalLinkAlt } from "react-icons/fa";
import { MetricInterface } from "shared/types/metric";
import {
  FactMetricInterface,
  ColumnRef,
  FactTableInterface,
} from "shared/types/fact-table";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import { getLegacyMetricSQL } from "shared/src/metric-migration";
import Checkbox from "@/ui/Checkbox";
import Code from "@/components/SyntaxHighlighting/Code";
import Modal from "@/components/Modal";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";

interface Props {
  factMetric: FactMetricInterface;
  legacyMetric: MetricInterface;
  factTable: FactTableInterface;
  enabled: boolean;
  disabled: boolean;
  onToggle: () => void;
}

const MetricComparisonRow: FC<Props> = ({
  factMetric,
  legacyMetric,
  factTable,
  enabled,
  disabled,
  onToggle,
}) => {
  const isActive = enabled && !disabled;
  const [JsonDiffModalOpen, setJsonDiffModalOpen] = useState(false);

  return (
    <div style={{ opacity: isActive ? 1 : 0.5 }} className="appbox p-3">
      {JsonDiffModalOpen && (
        <JsonDiffModal
          legacyMetric={legacyMetric}
          factMetric={factMetric}
          factTable={factTable}
          close={() => setJsonDiffModalOpen(false)}
        />
      )}
      <Flex gap="4">
        <div style={{ minWidth: 20 }}>
          <Checkbox
            value={isActive}
            setValue={() => onToggle()}
            disabled={!enabled}
          />
        </div>
        <Flex gap="2" style={{ flex: 1 }}>
          {/* Legacy metric (left) */}
          <div style={{ flex: 1 }} className="appbox p-3 bg-light">
            <h4 style={{ margin: "0 0 4px" }}>
              {legacyMetric.name}{" "}
              <a
                href={`/metric/${legacyMetric.id}`}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 12, verticalAlign: "middle" }}
              >
                <FaExternalLinkAlt />
              </a>
            </h4>
            <Flex gap="2">
              <div>
                Type: <strong>{legacyMetric.type}</strong>
              </div>
              {legacyMetric.templateVariables?.eventName && (
                <div>
                  Event Name:{" "}
                  <strong>{legacyMetric.templateVariables.eventName}</strong>
                </div>
              )}
              {legacyMetric.templateVariables?.valueColumn && (
                <div>
                  Value Column:{" "}
                  <strong>{legacyMetric.templateVariables.valueColumn}</strong>
                </div>
              )}
            </Flex>
            {legacyMetric.queryFormat === "builder" ||
            (!legacyMetric.queryFormat && !legacyMetric.sql) ? (
              <BuilderDetails metric={legacyMetric} />
            ) : legacyMetric.sql ? (
              <Code
                code={legacyMetric.sql}
                language="sql"
                expandable
                maxHeight="150px"
              />
            ) : null}
            {legacyMetric.aggregation && (
              <div>
                Aggregation: <code>{legacyMetric.aggregation}</code>
              </div>
            )}
          </div>

          <div style={{ paddingTop: 30 }}>
            <FaArrowRight />
          </div>

          {/* Fact metric (right) */}
          <div style={{ flex: 1 }} className="appbox p-3">
            <h4 style={{ margin: "0 0 4px" }}>{factMetric.name}</h4>
            <div className="mb-2">
              Type: <strong>{factMetric.metricType}</strong>
            </div>
            <div className="mb-2">
              <strong>Numerator</strong>
              <ColumnRefDetails columnRef={factMetric.numerator} />
            </div>
            {factMetric.denominator && (
              <div>
                <strong>Denominator</strong>
                <ColumnRefDetails columnRef={factMetric.denominator} />
              </div>
            )}
          </div>
        </Flex>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setJsonDiffModalOpen(true);
          }}
          style={{ fontSize: 12, alignSelf: "start", whiteSpace: "nowrap" }}
        >
          View Diff
        </a>
      </Flex>
    </div>
  );
};

function ColumnRefDetails({ columnRef }: { columnRef: ColumnRef }) {
  return (
    <div>
      <div>
        Column: <code>{columnRef.column}</code>
      </div>
      <div>
        Aggregation: <code>{columnRef.aggregation || "sum"}</code>
      </div>

      {columnRef.rowFilters && columnRef.rowFilters.length > 0 && (
        <div>
          <div>Row Filters:</div>
          <ul style={{ margin: "2px 0", paddingLeft: 20 }}>
            {columnRef.rowFilters.map((f, i) => (
              <li key={i}>
                {f.column} {f.operator} {f.values?.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function BuilderDetails({ metric }: { metric: MetricInterface }) {
  return (
    <div>
      {metric.table && (
        <div>
          Table: <code>{metric.table}</code>
        </div>
      )}
      {metric.column && (
        <div>
          Column: <code>{metric.column}</code>
        </div>
      )}
      {metric.timestampColumn && (
        <div>
          Timestamp: <code>{metric.timestampColumn}</code>
        </div>
      )}
      {metric.userIdColumns && (
        <div>
          User ID Columns:
          <ul style={{ margin: "2px 0", paddingLeft: 20 }}>
            {Object.entries(metric.userIdColumns).map(([key, value]) => (
              <li key={key}>{key === value ? key : `${key}: ${value}`}</li>
            ))}
          </ul>
        </div>
      )}
      {metric.conditions && metric.conditions.length > 0 && (
        <div>
          Conditions:
          <ul style={{ margin: "2px 0", paddingLeft: 20 }}>
            {metric.conditions.map((c, i) => (
              <li key={i}>
                {c.column} {c.operator} {c.value}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function JsonDiffModal({
  legacyMetric,
  factMetric,
  factTable,
  close,
}: {
  legacyMetric: MetricInterface;
  factMetric: FactMetricInterface;
  factTable: FactTableInterface;
  close: () => void;
}) {
  const { theme } = useAppearanceUITheme();

  // Keys in common, bring to the top
  const commonKeys = new Set(
    Object.keys(legacyMetric).filter((key) => key in factMetric),
  );

  // Sort keys so they can be compared easily
  // Bring common keys to the top
  const sortedLegacyMetric = Object.fromEntries(
    [
      ...commonKeys,
      ...Object.keys(legacyMetric).filter((key) => !commonKeys.has(key)),
    ].map((key) => [key, legacyMetric[key]]),
  ) as Partial<MetricInterface>;
  const sortedFactMetric = Object.fromEntries(
    [
      ...commonKeys,
      ...Object.keys(factMetric).filter((key) => !commonKeys.has(key)),
    ].map((key) => [key, factMetric[key]]),
  ) as Partial<FactMetricInterface>;

  const legacySQL = getLegacyMetricSQL(sortedLegacyMetric);
  const factSQL = factTable.sql;

  // Delete SQL fields from legacy metric
  delete sortedLegacyMetric.sql;
  delete sortedLegacyMetric.queryFormat;
  delete sortedLegacyMetric.table;
  delete sortedLegacyMetric.column;
  delete sortedLegacyMetric.timestampColumn;
  delete sortedLegacyMetric.userIdColumns;
  delete sortedLegacyMetric.conditions;
  delete sortedLegacyMetric.userIdTypes;
  delete sortedLegacyMetric.queries;
  delete sortedLegacyMetric.runStarted;
  delete sortedLegacyMetric.analysis;
  delete sortedLegacyMetric.analysisError;

  // Delete date fields and ids
  delete sortedLegacyMetric.id;
  delete sortedLegacyMetric.dateCreated;
  delete sortedLegacyMetric.dateUpdated;
  delete sortedFactMetric.id;
  delete sortedFactMetric.dateCreated;
  delete sortedFactMetric.dateUpdated;

  return (
    <Modal
      open
      close={close}
      onBackdropClick={close}
      header={`JSON Diff: ${legacyMetric.name}`}
      size="max"
      hideCta
      trackingEventModalType=""
    >
      {legacySQL !== factSQL && (
        <Box mb="4">
          <h3>Fact Table SQL</h3>
          <ReactDiffViewer
            oldValue={legacySQL}
            newValue={factSQL}
            compareMethod={DiffMethod.LINES}
            useDarkTheme={theme === "dark"}
            styles={{
              contentText: {
                wordBreak: "break-all",
              },
            }}
          />
        </Box>
      )}

      <h3>Metric Definition</h3>
      <ReactDiffViewer
        oldValue={JSON.stringify(sortedLegacyMetric, null, 2)}
        newValue={JSON.stringify(sortedFactMetric, null, 2)}
        compareMethod={DiffMethod.LINES}
        useDarkTheme={theme === "dark"}
        styles={{
          contentText: {
            wordBreak: "break-all",
          },
        }}
      />
    </Modal>
  );
}

export default MetricComparisonRow;

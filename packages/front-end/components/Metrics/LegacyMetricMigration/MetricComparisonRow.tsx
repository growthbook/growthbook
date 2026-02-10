import { FC } from "react";
import { Flex } from "@radix-ui/themes";
import { FaArrowRight, FaExternalLinkAlt } from "react-icons/fa";
import { MetricInterface } from "shared/types/metric";
import { FactMetricInterface, ColumnRef } from "shared/types/fact-table";
import Checkbox from "@/ui/Checkbox";
import Code from "@/components/SyntaxHighlighting/Code";

interface Props {
  factMetric: FactMetricInterface;
  legacyMetric: MetricInterface;
  enabled: boolean;
  disabled: boolean;
  onToggle: () => void;
}

const MetricComparisonRow: FC<Props> = ({
  factMetric,
  legacyMetric,
  enabled,
  disabled,
  onToggle,
}) => {
  const isActive = enabled && !disabled;

  return (
    <div style={{ opacity: isActive ? 1 : 0.5 }} className="appbox p-3">
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

export default MetricComparisonRow;

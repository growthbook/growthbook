import { FC, useState, useCallback } from "react";
import { FaChevronDown, FaChevronRight } from "react-icons/fa";
import { MetricInterface } from "shared/types/metric";
import Badge from "@/ui/Badge";
import Code from "@/components/SyntaxHighlighting/Code";

interface Props {
  items: { metric: MetricInterface; reason: string }[];
}

const UnconvertedSection: FC<Props> = ({ items }) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  if (items.length === 0) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <h3>Unconverted Metrics ({items.length})</h3>
      <div
        style={{
          border: "1px solid var(--border-color-200)",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        {items.map(({ metric, reason }) => {
          const expanded = expandedIds.has(metric.id);
          return (
            <div
              key={metric.id}
              style={{
                borderBottom: "1px solid var(--border-color-200)",
              }}
            >
              <div
                onClick={() => toggle(metric.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                {expanded ? (
                  <FaChevronDown size={12} />
                ) : (
                  <FaChevronRight size={12} />
                )}
                <strong>{metric.name}</strong>
                <Badge label={metric.type} color="gray" variant="soft" />
                <span
                  style={{ fontSize: 13, color: "var(--text-color-muted)" }}
                >
                  {reason}
                </span>
              </div>
              {expanded && (
                <div style={{ padding: "0 12px 12px 32px" }}>
                  {metric.sql && (
                    <Code
                      code={metric.sql}
                      language="sql"
                      expandable
                      maxHeight="200px"
                    />
                  )}
                  {(metric.queryFormat === "builder" ||
                    (!metric.queryFormat && !metric.sql)) && (
                    <div style={{ fontSize: 13 }}>
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
                  )}
                  {metric.aggregation && (
                    <div style={{ fontSize: 13 }}>
                      Aggregation: <code>{metric.aggregation}</code>
                    </div>
                  )}
                  {metric.denominator && (
                    <div style={{ fontSize: 13 }}>
                      Denominator: <code>{metric.denominator}</code>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default UnconvertedSection;

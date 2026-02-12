import { FC, useState, useRef, useEffect } from "react";
import { FaPencilAlt } from "react-icons/fa";
import { MetricInterface } from "shared/types/metric";
import {
  FactTableInterface,
  FactMetricInterface,
} from "shared/types/fact-table";
import { Flex } from "@radix-ui/themes";
import Frame from "@/ui/Frame";
import Checkbox from "@/ui/Checkbox";
import Code from "@/components/SyntaxHighlighting/Code";
import Modal from "@/components/Modal";
import SortedTags from "@/components/Tags/SortedTags";
import MetricComparisonRow from "./MetricComparisonRow";

interface Props {
  factTable: FactTableInterface;
  factTableName: string;
  factMetrics: FactMetricInterface[];
  legacyMetricById: Map<string, MetricInterface>;
  checked: boolean | "indeterminate";
  sectionEnabled: boolean;
  disabledMetricIds: Set<string>;
  onToggleSection: () => void;
  onToggleMetric: (factMetricId: string) => void;
  onRenameFactTable: (name: string) => void;
}

const FactTableSection: FC<Props> = ({
  factTable,
  factTableName,
  factMetrics,
  legacyMetricById,
  checked,
  sectionEnabled,
  disabledMetricIds,
  onToggleSection,
  onToggleMetric,
  onRenameFactTable,
}) => {
  const [editing, setEditing] = useState(false);
  const [jsonModalOpen, setJsonModalOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  return (
    <Frame style={{ opacity: sectionEnabled ? 1 : 0.5, marginBottom: 16 }}>
      <Flex gap="4" alignItems="center">
        <Checkbox value={checked} setValue={() => onToggleSection()} />
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            defaultValue={factTableName}
            onBlur={(e) => {
              const val = e.target.value.trim();
              if (val) onRenameFactTable(val);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                setEditing(false);
              }
            }}
            style={{
              fontSize: "1.17em",
              fontWeight: "bold",
              border: "1px solid var(--border-color-200)",
              borderRadius: 4,
              padding: "2px 6px",
              flex: 1,
            }}
          />
        ) : (
          <>
            <h3 style={{ margin: 0, padding: 0 }}>{factTableName}</h3>
            <div>
              <FaPencilAlt
                size={12}
                style={{ cursor: "pointer", color: "var(--text-color-muted)" }}
                onClick={() => setEditing(true)}
                title="Rename fact table"
              />
            </div>
          </>
        )}

        <div className="ml-4">
          <SortedTags tags={factTable.tags} />
        </div>

        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setJsonModalOpen(true);
          }}
          style={{ fontSize: 12 }}
          className="ml-auto"
        >
          View JSON
        </a>
      </Flex>
      <div>
        <Code
          code={factTable.sql}
          language="sql"
          expandable
          maxHeight="200px"
        />
      </div>
      {jsonModalOpen && (
        <Modal
          open
          close={() => setJsonModalOpen(false)}
          header={`Fact Table JSON: ${factTableName}`}
          size="lg"
          hideCta
          trackingEventModalType=""
          onBackdropClick={() => setJsonModalOpen(false)}
        >
          <Code code={JSON.stringify(factTable, null, 2)} language="json" />
        </Modal>
      )}
      <div style={{ marginTop: 12 }}>
        <h4>Metrics</h4>
        {factMetrics.map((fm) => {
          const legacyId = fm.id.replace(/^fact__/, "");
          const legacyMetric = legacyMetricById.get(legacyId);
          if (!legacyMetric) return null;

          return (
            <MetricComparisonRow
              key={fm.id}
              factMetric={fm}
              legacyMetric={legacyMetric}
              factTable={factTable}
              enabled={sectionEnabled}
              disabled={disabledMetricIds.has(fm.id)}
              onToggle={() => onToggleMetric(fm.id)}
            />
          );
        })}
      </div>
    </Frame>
  );
};

export default FactTableSection;

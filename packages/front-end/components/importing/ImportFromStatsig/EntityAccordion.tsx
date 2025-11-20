import React from "react";
import { FaChevronDown, FaChevronRight } from "react-icons/fa";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer";
import { transformPayloadForDiffDisplay } from "@/services/importing/statsig/util";

interface EntityAccordionProps {
  entity: unknown;
  entityId: string;
  isExpanded: boolean;
  onToggle: (id: string) => void;
}

export const EntityAccordion: React.FC<EntityAccordionProps> = ({
  entityId,
  isExpanded,
  onToggle,
}) => {
  const toggleExpanded = () => {
    onToggle(entityId);
  };

  return (
    <td>
      <button
        type="button"
        onClick={toggleExpanded}
        className="btn btn-link px-2 py-0"
      >
        {isExpanded ? (
          <FaChevronDown size={18} />
        ) : (
          <FaChevronRight size={18} />
        )}
      </button>
    </td>
  );
};

interface EntityAccordionContentProps {
  entity: unknown;
  isExpanded: boolean;
  importItem?: {
    hasChanges?: boolean;
    transformedData?: string; // Pre-prepared JSON string (right column)
    existingData?: string; // Pre-prepared JSON string (left column)
    existing?: unknown;
    existingSavedGroup?: unknown;
    existingExperiment?: unknown;
    existingTag?: unknown;
    existingEnvironment?: unknown;
    existingMetric?: unknown;
    existingMetricSource?: unknown;
  };
}

export const EntityAccordionContent: React.FC<EntityAccordionContentProps> = ({
  entity,
  isExpanded,
  importItem,
}) => {
  if (!isExpanded) return null;

  // Use pre-prepared data from Phase 2 transformation if available
  // Fallback to generating on-the-fly if not set (for backwards compatibility)
  let existingJson = importItem?.existingData || "";
  const transformedData = importItem?.transformedData || "";

  // Check if there's an existing item (for update scenarios)
  const hasExistingItem =
    !!importItem?.existing ||
    !!importItem?.existingSavedGroup ||
    !!importItem?.existingExperiment ||
    !!importItem?.existingTag ||
    !!importItem?.existingEnvironment ||
    !!importItem?.existingMetric ||
    !!importItem?.existingMetricSource;

  // If existingData wasn't pre-prepared but we have an existing item, generate it from existing object
  if (!existingJson && hasExistingItem) {
    const existingData =
      importItem?.existing ||
      importItem?.existingSavedGroup ||
      importItem?.existingExperiment ||
      importItem?.existingTag ||
      importItem?.existingEnvironment ||
      importItem?.existingMetric ||
      importItem?.existingMetricSource;

    if (existingData && typeof existingData === "object") {
      // Determine entity type
      let entityType:
        | "feature"
        | "experiment"
        | "segment"
        | "tag"
        | "environment"
        | "metric"
        | "metricSource" = "feature";
      if (importItem?.existingExperiment) entityType = "experiment";
      else if (importItem?.existingSavedGroup) entityType = "segment";
      else if (importItem?.existingTag) entityType = "tag";
      else if (importItem?.existingEnvironment) entityType = "environment";
      else if (importItem?.existingMetric) entityType = "metric";
      else if (importItem?.existingMetricSource) entityType = "metricSource";

      // Remove metadata fields
      const existingRecord = existingData as Record<string, unknown>;
      const {
        organization: _organization,
        dateCreated: _dateCreated,
        dateUpdated: _dateUpdated,
        version: _version,
        ...rest
      } = existingRecord;

      // For non-tag entities, remove id as it's metadata
      // For tags, keep id as it's part of the data
      const payload =
        entityType === "tag"
          ? rest
          : (() => {
              const { id: _id, ...restWithoutId } = rest;
              return restWithoutId;
            })();

      // Transform and stringify
      const transformed = transformPayloadForDiffDisplay(
        payload as Record<string, unknown>,
        entityType,
      );
      existingJson = JSON.stringify(transformed, null, 2);
    }
  }

  // Show diff whenever there's an existing item and transformed data (even if no changes detected)
  const showDiff = hasExistingItem && !!existingJson && !!transformedData;

  return (
    <tr>
      <td
        colSpan={100}
        className="p-0"
        style={{
          padding: 0,
          border: "none",
        }}
      >
        <div
          className="bg-light"
          style={{
            borderTop: "1px solid #dee2e6",
            width: "100%",
            margin: 0,
            boxSizing: "border-box",
          }}
        >
          {showDiff && (
            <div
              style={{
                padding: "12px",
                borderBottom: "1px solid #dee2e6",
                backgroundColor: "#f8f9fa",
              }}
            >
              <h6 className="mb-2">Changes</h6>
              <div
                style={{
                  maxHeight: "400px",
                  overflowY: "auto",
                  fontSize: "11px",
                }}
                className="diff-viewer-wrapper"
              >
                <ReactDiffViewer
                  oldValue={existingJson}
                  newValue={transformedData}
                  compareMethod={DiffMethod.LINES}
                  splitView={true}
                  leftTitle="Existing (GrowthBook)"
                  rightTitle="Update (preview - may differ upon importing)"
                  styles={{
                    diffContainer: {
                      fontSize: "11px",
                      lineHeight: "1.1",
                    },
                    line: {
                      fontSize: "11px",
                      padding: "1px 2px",
                      lineHeight: "1.1",
                    },
                    contentText: {
                      fontSize: "11px",
                      lineHeight: "1.1",
                    },
                    gutter: {
                      fontSize: "11px",
                      padding: "1px 2px",
                      lineHeight: "1.1",
                    },
                  }}
                />
              </div>
            </div>
          )}
          <div
            style={{
              maxHeight: "300px",
              overflowY: "auto",
              width: "100%",
              padding: "12px",
              margin: 0,
              boxSizing: "border-box",
            }}
          >
            <h6 className="mb-2">Statsig Definition</h6>
            <code
              style={{
                fontSize: "11px",
                lineHeight: "1.1",
                whiteSpace: "pre-wrap",
                display: "block",
                width: "100%",
                wordBreak: "break-all",
              }}
            >
              {JSON.stringify(entity, null, 2)}
            </code>
          </div>
        </div>
      </td>
    </tr>
  );
};

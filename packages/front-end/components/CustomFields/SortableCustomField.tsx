import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React from "react";
import { CustomField } from "shared/types/custom-fields";
import { RiDraggable } from "react-icons/ri";
import CustomFieldRowMenu from "@/components/CustomFields/CustomFieldRowMenu";
import ProjectBadges from "@/components/ProjectBadges";
import Tooltip from "@/components/Tooltip/Tooltip";

const MULTI_VALUE_LIMIT = 3;

function EnumValuesDisplay({ valuesStr }: { valuesStr: string | undefined }) {
  const parts = (valuesStr ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length <= MULTI_VALUE_LIMIT) {
    return <>: ({parts.join(", ")})</>;
  }
  return (
    <>
      : ({parts.slice(0, MULTI_VALUE_LIMIT).join(", ")}{" "}
      <Tooltip
        body={
          <div>
            {parts.slice(MULTI_VALUE_LIMIT).map((v, i) => (
              <span key={i}>
                {v}
                {i < parts.length - MULTI_VALUE_LIMIT - 1 ? ", " : ""}
              </span>
            ))}
          </div>
        }
        usePortal
      >
        <span>
          <em>+ {parts.length - MULTI_VALUE_LIMIT} more</em>
        </span>
      </Tooltip>
      )
    </>
  );
}

export const CUSTOM_FIELD_TABLE_WIDTHS = {
  dragHandle: 30,
  menu: 30,
  name: "10%",
  key: "14%",
  description: "20%",
  appliesTo: "10%",
  valueType: undefined, // fill width
  projects: "15%",
  required: "7%",
} as const;

interface SortableProps {
  customField: CustomField;
  setEditModal: (cf: CustomField) => void;
  deleteCustomField: (cf: CustomField) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canManage: boolean;
  showAppliesTo: boolean;
  showRequired: boolean;
}

export function SortableCustomFieldRow(props: SortableProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.customField.id });
  const customField = props.customField;
  const { showAppliesTo, showRequired } = props;
  const WIDTHS = CUSTOM_FIELD_TABLE_WIDTHS;
  const style: React.CSSProperties = {
    transition,
    ...(isDragging
      ? { opacity: 0, pointerEvents: "none" as const }
      : {
          transform: CSS.Transform.toString(transform),
          opacity: 1,
        }),
  };
  const handleStyle = {
    fontSize: 20,
    color: "var(--slate-a6)",
    cursor: `${isDragging ? "grabbing" : "grab"}`,
  };

  const sectionLabel =
    customField.section === "feature" ? "Feature" : "Experiment";

  return (
    <tr ref={setNodeRef} style={style}>
      <td
        style={{
          width: WIDTHS.dragHandle,
          minWidth: WIDTHS.dragHandle,
          padding: "0.4rem 0",
          textAlign: "center",
        }}
      >
        <div className="d-flex flex-column">
          <div style={handleStyle} {...attributes} {...listeners}>
            <RiDraggable />
          </div>
        </div>
      </td>
      <td style={{ width: WIDTHS.name }} className="text-gray font-weight-bold">
        {customField.name}
      </td>
      <td style={{ width: WIDTHS.key }} className="text-gray">
        <code className="small">{customField.id}</code>
      </td>
      <td style={{ width: WIDTHS.description }} className="text-gray">
        {customField.description ?? ""}
      </td>
      {showAppliesTo && (
        <td style={{ width: WIDTHS.appliesTo }} className="text-gray">
          {sectionLabel}
        </td>
      )}
      <td style={{ width: WIDTHS.valueType }} className="text-gray">
        {customField.type}
        {(customField.type === "enum" ||
          customField.type === "multiselect") && (
          <EnumValuesDisplay valuesStr={customField.values} />
        )}
      </td>
      <td style={{ width: WIDTHS.projects }} className="text-gray">
        <ProjectBadges
          resourceType="custom field"
          projectIds={
            customField?.projects?.length ? customField.projects : undefined
          }
        />
      </td>
      {showRequired && (
        <td style={{ width: WIDTHS.required }} className="text-gray">
          {customField.required ? <>yes</> : ""}
        </td>
      )}
      <td
        style={{
          width: WIDTHS.menu,
          minWidth: WIDTHS.menu,
          padding: "0.6rem 0.5rem 0 0",
          textAlign: "center",
        }}
      >
        <CustomFieldRowMenu
          canEdit={props.canManage}
          canDelete={props.canManage}
          canMoveUp={props.canMoveUp}
          canMoveDown={props.canMoveDown}
          onEdit={() => props.setEditModal(customField)}
          onDelete={() => props.deleteCustomField(customField)}
          onMoveUp={props.onMoveUp}
          onMoveDown={props.onMoveDown}
        />
      </td>
    </tr>
  );
}

export function StaticCustomFieldRow({
  customField,
  showAppliesTo = true,
  showRequired = true,
}: {
  customField: CustomField;
  showAppliesTo?: boolean;
  showRequired?: boolean;
}) {
  const WIDTHS = CUSTOM_FIELD_TABLE_WIDTHS;
  const style = { opacity: 0.6 };
  const handleStyle = {
    fontSize: 20,
    color: "rgba(0,0,0,0.2)",
    cursor: "grabbing",
  };
  const sectionLabel =
    customField.section === "feature" ? "Feature" : "Experiment";

  return (
    <tr style={style}>
      <td
        style={{
          width: WIDTHS.dragHandle,
          minWidth: WIDTHS.dragHandle,
          padding: "0.5rem 0",
          textAlign: "center",
        }}
      >
        <div className="d-flex flex-column">
          <div style={handleStyle}>
            <RiDraggable />
          </div>
        </div>
      </td>
      <td style={{ width: WIDTHS.name }} className="text-gray font-weight-bold">
        {customField.name}
      </td>
      <td style={{ width: WIDTHS.key }} className="text-gray">
        <code className="small">{customField.id}</code>
      </td>
      <td style={{ width: WIDTHS.description }} className="text-gray">
        {customField.description ?? ""}
      </td>
      {showAppliesTo && (
        <td style={{ width: WIDTHS.appliesTo }} className="text-gray">
          {sectionLabel}
        </td>
      )}
      <td style={{ width: WIDTHS.valueType }} className="text-gray">
        {customField.type}
        {(customField.type === "enum" ||
          customField.type === "multiselect") && (
          <EnumValuesDisplay valuesStr={customField.values} />
        )}
      </td>
      <td style={{ width: WIDTHS.projects }} className="text-gray">
        {(customField.projects?.length || 0) > 0 ? (
          <ProjectBadges
            resourceType="custom field"
            projectIds={customField.projects}
          />
        ) : (
          <ProjectBadges resourceType="custom field" />
        )}
      </td>
      {showRequired && (
        <td style={{ width: WIDTHS.required }} className="text-gray">
          {customField.required ? <>yes</> : ""}
        </td>
      )}
      <td
        style={{
          width: WIDTHS.menu,
          minWidth: WIDTHS.menu,
          padding: "1rem 0.5rem",
          textAlign: "center",
        }}
      />
    </tr>
  );
}

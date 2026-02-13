import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React from "react";
import { CustomField } from "shared/types/custom-fields";
import { RiDraggable } from "react-icons/ri";
import { CUSTOM_FIELD_SECTION_LABELS } from "@/components/CustomFields/constants";
import type { CustomFieldWithArrayIndex } from "@/components/CustomFields/CustomFields";
import CustomFieldRowMenu from "@/components/CustomFields/CustomFieldRowMenu";
import ProjectBadges from "@/components/ProjectBadges";
import Tooltip from "@/components/Tooltip/Tooltip";

const MULTI_VALUE_LIMIT = 3;

function formatSectionsLabel(sections: string[] | undefined): React.ReactNode {
  if (!sections || sections.length === 0) return <em>none</em>;
  const ordered = Object.keys(CUSTOM_FIELD_SECTION_LABELS).filter((k) =>
    sections.includes(k),
  );
  return ordered
    .map(
      (k) =>
        CUSTOM_FIELD_SECTION_LABELS[
          k as keyof typeof CUSTOM_FIELD_SECTION_LABELS
        ],
    )
    .join(", ");
}

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
  menu: 40,
  name: "10%",
  key: "14%",
  description: "20%",
  appliesTo: "10%",
  valueType: undefined, // fill width
  projects: "15%",
  required: "7%",
} as const;

interface SortableProps {
  customField: CustomFieldWithArrayIndex;
  setEditModal: (cf: CustomField) => void;
  deleteCustomField: (cf: CustomFieldWithArrayIndex) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canManage: boolean;
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
  const { showRequired } = props;
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
  const tdStyle: React.CSSProperties = { verticalAlign: "top" };
  const handleStyle = {
    fontSize: 20,
    color: "var(--slate-a6)",
    cursor: `${isDragging ? "grabbing" : "grab"}`,
  };

  return (
    <tr ref={setNodeRef} style={style}>
      <td
        style={{
          ...tdStyle,
          width: WIDTHS.dragHandle,
          minWidth: WIDTHS.dragHandle,
          padding: "0.65rem 0",
          textAlign: "center",
        }}
      >
        <div className="d-flex flex-column">
          <div style={handleStyle} {...attributes} {...listeners}>
            <RiDraggable />
          </div>
        </div>
      </td>
      <td
        style={{ ...tdStyle, width: WIDTHS.name }}
        className="text-gray font-weight-bold"
      >
        {customField.name}
      </td>
      <td style={{ ...tdStyle, width: WIDTHS.key }} className="text-gray">
        <code className="small">{customField.id}</code>
      </td>
      <td
        style={{ ...tdStyle, width: WIDTHS.description }}
        className="text-gray"
      >
        {customField.description && customField.description.length > 80
          ? customField.description.substring(0, 80).trim() + "..."
          : (customField.description ?? "")}
      </td>
      <td style={{ ...tdStyle, width: WIDTHS.appliesTo }} className="text-gray">
        {formatSectionsLabel(customField.sections)}
      </td>
      <td style={{ ...tdStyle, width: WIDTHS.valueType }} className="text-gray">
        {customField.type}
        {(customField.type === "enum" ||
          customField.type === "multiselect") && (
          <EnumValuesDisplay valuesStr={customField.values} />
        )}
      </td>
      <td style={{ ...tdStyle, width: WIDTHS.projects }} className="text-gray">
        <ProjectBadges
          resourceType="custom field"
          projectIds={
            customField?.projects?.length ? customField.projects : undefined
          }
        />
      </td>
      {showRequired && (
        <td
          style={{ ...tdStyle, width: WIDTHS.required }}
          className="text-gray"
        >
          {customField.required ? <>yes</> : ""}
        </td>
      )}
      <td
        style={{
          ...tdStyle,
          width: WIDTHS.menu,
          minWidth: WIDTHS.menu,
          padding: "0.5rem 0",
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
  showRequired = true,
}: {
  customField: CustomField;
  showRequired?: boolean;
}) {
  const WIDTHS = CUSTOM_FIELD_TABLE_WIDTHS;
  const style = { opacity: 0.6 };
  const tdStyle: React.CSSProperties = { verticalAlign: "top" };
  const handleStyle = {
    fontSize: 20,
    color: "rgba(0,0,0,0.2)",
    cursor: "grabbing",
  };
  const sectionLabel = formatSectionsLabel(customField.sections);

  return (
    <tr style={style}>
      <td
        style={{
          ...tdStyle,
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
      <td
        style={{ ...tdStyle, width: WIDTHS.name }}
        className="text-gray font-weight-bold"
      >
        {customField.name}
      </td>
      <td style={{ ...tdStyle, width: WIDTHS.key }} className="text-gray">
        <code className="small">{customField.id}</code>
      </td>
      <td
        style={{ ...tdStyle, width: WIDTHS.description }}
        className="text-gray"
      >
        {customField.description && customField.description.length > 100
          ? customField.description.substring(0, 100).trim() + "..."
          : (customField.description ?? "")}
      </td>
      <td style={{ ...tdStyle, width: WIDTHS.appliesTo }} className="text-gray">
        {sectionLabel}
      </td>
      <td style={{ ...tdStyle, width: WIDTHS.valueType }} className="text-gray">
        {customField.type}
        {(customField.type === "enum" ||
          customField.type === "multiselect") && (
          <EnumValuesDisplay valuesStr={customField.values} />
        )}
      </td>
      <td style={{ ...tdStyle, width: WIDTHS.projects }} className="text-gray">
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
        <td
          style={{ ...tdStyle, width: WIDTHS.required }}
          className="text-gray"
        >
          {customField.required ? <>yes</> : ""}
        </td>
      )}
      <td
        style={{
          ...tdStyle,
          width: WIDTHS.menu,
          minWidth: WIDTHS.menu,
          padding: "1rem 0.5rem",
          textAlign: "center",
        }}
      />
    </tr>
  );
}

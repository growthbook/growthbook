import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React from "react";
import { CustomField } from "shared/types/custom-fields";
import { RiDraggable } from "react-icons/ri";
import { PiWarningBold } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import { CUSTOM_FIELD_SECTION_LABELS } from "@/components/CustomFields/constants";
import type { CustomFieldWithArrayIndex } from "@/components/CustomFields/CustomFields";
import CustomFieldRowMenu from "@/components/CustomFields/CustomFieldRowMenu";
import ProjectBadges from "@/components/ProjectBadges";
import Tooltip from "@/components/Tooltip/Tooltip";
import Badge from "@/ui/Badge";
import Text from "@/ui/Text";

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
  toggleCustomField: (cf: CustomFieldWithArrayIndex) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canManage: boolean;
  showRequired: boolean;
  isDuplicateId?: boolean;
}

const tdStyle: React.CSSProperties = { verticalAlign: "top" };
const codeColor: React.CSSProperties["color"] = "var(--color-text-mid)";

function RowCells({
  customField,
  showRequired,
  isDuplicateId,
}: {
  customField: CustomField;
  showRequired: boolean;
  isDuplicateId?: boolean;
}) {
  const WIDTHS = CUSTOM_FIELD_TABLE_WIDTHS;
  const isDisabled = customField.active === false;

  return (
    <>
      <td style={{ ...tdStyle, width: WIDTHS.name }}>
        <Flex wrap="wrap" align="center" gap="2">
          <Text weight="semibold" color={isDisabled ? "text-low" : "text-mid"}>
            {customField.name}
          </Text>
          {isDisabled && <Badge label="disabled" color="gray" variant="soft" />}
        </Flex>
      </td>
      <td style={{ ...tdStyle, width: WIDTHS.key }}>
        <Flex align="center">
          {isDuplicateId && (
            <Tooltip
              body="Duplicate key detected. Consider manually merging duplicate fields."
              usePortal
            >
              <PiWarningBold
                style={{
                  color: "var(--red-9)",
                  flexShrink: 0,
                  marginRight: "0.25rem",
                }}
              />
            </Tooltip>
          )}
          <code
            style={{
              wordBreak: "break-all",
              color: codeColor,
              fontSize: "0.85em",
            }}
          >
            {customField.id}
          </code>
        </Flex>
      </td>
      <td style={{ ...tdStyle, width: WIDTHS.description }}>
        <Text color="text-mid">
          {customField.description && customField.description.length > 80
            ? customField.description.substring(0, 80).trim() + "..."
            : (customField.description ?? "")}
        </Text>
      </td>
      <td style={{ ...tdStyle, width: WIDTHS.appliesTo }}>
        <Text color="text-mid">
          {formatSectionsLabel(customField.sections)}
        </Text>
      </td>
      <td style={{ ...tdStyle, width: WIDTHS.valueType }}>
        <Text color="text-mid">
          {customField.type}
          {(customField.type === "enum" ||
            customField.type === "multiselect") && (
            <EnumValuesDisplay valuesStr={customField.values} />
          )}
        </Text>
      </td>
      <td style={{ ...tdStyle, width: WIDTHS.projects }}>
        <ProjectBadges
          resourceType="custom field"
          projectIds={
            customField.projects?.length ? customField.projects : undefined
          }
        />
      </td>
      {showRequired && (
        <td style={{ ...tdStyle, width: WIDTHS.required }}>
          <Text color="text-mid">{customField.required ? "yes" : ""}</Text>
        </td>
      )}
    </>
  );
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
  const { showRequired, isDuplicateId } = props;
  const isDisabled = customField.active === false;
  const WIDTHS = CUSTOM_FIELD_TABLE_WIDTHS;
  const style: React.CSSProperties = {
    transition,
    ...(isDragging
      ? { opacity: 0, pointerEvents: "none" as const }
      : { transform: CSS.Transform.toString(transform), opacity: 1 }),
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
        <Flex direction="column">
          <div
            style={{
              fontSize: 20,
              color: "var(--slate-a6)",
              cursor: isDragging ? "grabbing" : "grab",
            }}
            {...attributes}
            {...listeners}
          >
            <RiDraggable />
          </div>
        </Flex>
      </td>
      <RowCells
        customField={customField}
        showRequired={showRequired}
        isDuplicateId={isDuplicateId}
      />
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
          isActive={!isDisabled}
          onEdit={() => props.setEditModal(customField)}
          onDelete={() => props.deleteCustomField(customField)}
          onMoveUp={props.onMoveUp}
          onMoveDown={props.onMoveDown}
          onToggleActive={() => props.toggleCustomField(customField)}
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

  return (
    <tr style={{ opacity: 0.6, borderBottom: "1px solid var(--gray-a5)" }}>
      <td
        style={{
          ...tdStyle,
          width: WIDTHS.dragHandle,
          minWidth: WIDTHS.dragHandle,
          padding: "0.5rem 0",
          textAlign: "center",
        }}
      >
        <Flex direction="column">
          <div
            style={{
              fontSize: 20,
              color: "rgba(0,0,0,0.2)",
              cursor: "grabbing",
            }}
          >
            <RiDraggable />
          </div>
        </Flex>
      </td>
      <RowCells customField={customField} showRequired={showRequired} />
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

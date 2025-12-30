import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React from "react";
import { CustomField } from "shared/types/custom-fields";
import { RiDraggable } from "react-icons/ri";
import { GBEdit } from "@/components/Icons";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useDefinitions } from "@/services/DefinitionsContext";

interface SortableProps {
  customField: CustomField;
  setEditModal: (CustomField) => void;
  deleteCustomField: (CustomField) => void;
}

export function SortableCustomFieldRow(props: SortableProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    active,
  } = useSortable({ id: props.customField.id });
  const { getProjectById } = useDefinitions();
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: active?.id === props.customField.id ? 0.3 : 1,
  };
  const customField = props.customField;

  const draggedRowStyle = { background: "rgba(127, 207, 250, 0.3)" };
  const handleStyle = {
    fontSize: 20,
    color: "var(--slate-a6)",
    cursor: `${isDragging ? "grabbing" : "grab"}`,
  };

  return (
    <tr ref={setNodeRef} style={style}>
      {isDragging ? (
        <td colSpan={10} style={draggedRowStyle}>
          &nbsp;
        </td>
      ) : (
        <>
          <td style={{ width: "30px", padding: "0.5rem" }}>
            <div className="d-flex flex-column">
              <div style={handleStyle} {...attributes} {...listeners}>
                <RiDraggable />
              </div>
            </div>
          </td>
          <td className="text-gray font-weight-bold">{customField.name}</td>
          <td className="text-gray">{customField.id}</td>
          <td className="text-gray">{customField.description}</td>
          <td className="text-gray">
            {customField.type}
            {(customField.type === "enum" ||
              customField.type === "multiselect") && (
              <>: ({customField.values})</>
            )}
          </td>
          <td className="text-gray">
            {customField.type === "boolean"
              ? JSON.stringify(customField.defaultValue)
              : customField.defaultValue}
          </td>
          <td className="text-gray">{customField?.placeholder ?? ""}</td>
          <td className="text-gray">
            {customField.projects && (
              <>
                {customField.projects
                  .map((p) => {
                    return getProjectById(p)?.name || "";
                  })
                  ?.join(", ")}
              </>
            )}
          </td>
          <td className="text-gray">{customField.required && <>yes</>}</td>
          <td className="">
            <a
              href="#"
              className="tr-hover"
              onClick={(e) => {
                e.preventDefault();
                props.setEditModal(customField);
              }}
            >
              <span className="h4 pr-2 m-0 d-inline-block align-top">
                <GBEdit />
              </span>
            </a>
            <DeleteButton
              className="tr-hover h4 pr-2 m-0 d-inline-block align-top"
              displayName="Custom Field"
              useIcon={true}
              link={true}
              onClick={async () => {
                await props.deleteCustomField(customField);
              }}
            />
          </td>
        </>
      )}
    </tr>
  );
}

export function StaticCustomFieldRow({
  customField,
}: {
  customField: CustomField;
}) {
  const { getProjectById } = useDefinitions();
  const style = {
    opacity: 0.6,
  };
  const handleStyle = {
    fontSize: 20,
    color: "rgba(0,0,0,0.2)",
    cursor: "grabbing",
  };

  return (
    <tr style={style}>
      <td style={{ width: "30px", padding: "0.5rem" }}>
        <div className="d-flex flex-column">
          <div style={handleStyle}>
            <RiDraggable />
          </div>
        </div>
      </td>
      <td className="text-gray font-weight-bold">{customField.name}</td>
      <td className="text-gray">{customField.id}</td>
      <td className="text-gray">{customField.description}</td>
      <td className="text-gray">
        {customField.type}
        {(customField.type === "enum" ||
          customField.type === "multiselect") && <>: ({customField.values})</>}
      </td>
      <td className="text-gray">{customField?.placeholder ?? ""}</td>
      <td className="text-gray">
        {customField.projects && (
          <>
            {customField.projects
              .map((p) => {
                return getProjectById(p)?.name || "";
              })
              ?.join(", ")}
          </>
        )}
      </td>
      <td className="text-gray">{customField.required && <>yes</>}</td>
      <td className="" style={{ width: 75 }}></td>
    </tr>
  );
}

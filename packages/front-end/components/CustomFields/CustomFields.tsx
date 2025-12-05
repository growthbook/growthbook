import React, { FC, useEffect, useMemo, useState } from "react";
import { CustomField, CustomFieldSection } from "back-end/types/custom-fields";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import {
  SortableCustomFieldRow,
  StaticCustomFieldRow,
} from "@/components/CustomFields/SortableCustomField";
import CustomFieldModal from "@/components/CustomFields/CustomFieldModal";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

const CustomFields: FC<{
  section: CustomFieldSection;
  title: string;
}> = ({ section, title }) => {
  const [modalOpen, setModalOpen] = useState<Partial<CustomField> | null>(null);
  const { customFields, mutateDefinitions } = useDefinitions();
  const { apiCall } = useAuth();
  const [activeId, setActiveId] = useState();
  const [items, setItems] = useState(
    customFields?.filter((x) => x.section === section),
  );
  const permissionsUtils = usePermissionsUtil();

  useEffect(() => {
    setItems(customFields?.filter((x) => x.section === section));
  }, [customFields, section]);

  const selectedRow = useMemo(() => {
    if (!activeId) {
      return null;
    }
    return items?.find((cf) => cf.id === activeId);
  }, [activeId, items]);

  const deleteCustomField = async (customField: CustomField) => {
    await apiCall(`/custom-fields/${customField.id}`, {
      method: "DELETE",
    }).then(() => {
      track("Delete Custom Experiment Field", {
        type: customField.type,
      });
      mutateDefinitions();
    });
  };

  const sensors = useSensors(
    useSensor(MouseSensor, {}),
    useSensor(TouchSensor, {}),
    useSensor(KeyboardSensor, {}),
  );

  function handleDragStart(event) {
    setActiveId(event.active.id);
  }

  async function handleDragEnd(event) {
    if (items) {
      const { active, over } = event;
      if (active.id !== over.id) {
        // it moved:
        const oldIndex = items?.findIndex((x) => x.id === active.id);
        const newIndex = items?.findIndex((x) => x.id === over.id);
        const newItems = arrayMove(items, oldIndex, newIndex);
        setItems(newItems);
        await apiCall(`/custom-fields/reorder`, {
          method: "POST",
          body: JSON.stringify({
            oldId: active.id,
            newId: over.id,
          }),
        }).then(() => {
          mutateDefinitions();
        });
      }

      setActiveId(undefined);
    }
  }

  function handleDragCancel() {
    setActiveId(undefined);
  }

  return (
    <>
      <div className="mb-5">
        <div className="row mb-3 align-items-center">
          <div className="col-auto">
            <h3>{title}</h3>
          </div>
          <div style={{ flex: 1 }} />
          {permissionsUtils.canManageCustomFields() && (
            <div className="col-auto">
              <Button
                onClick={() => {
                  setModalOpen({});
                }}
              >
                Add Custom Field
              </Button>
            </div>
          )}
        </div>
        <DndContext
          sensors={sensors}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
          onDragCancel={handleDragCancel}
          collisionDetection={closestCenter}
        >
          <Table variant="standard" className="appbox">
            <TableHeader>
              <TableRow>
                <TableColumnHeader style={{ width: "30px" }}></TableColumnHeader>
                <TableColumnHeader>Field Name</TableColumnHeader>
                <TableColumnHeader>Field Key</TableColumnHeader>
                <TableColumnHeader>Description</TableColumnHeader>
                <TableColumnHeader>Type</TableColumnHeader>
                <TableColumnHeader>Default value</TableColumnHeader>
                <TableColumnHeader>Placeholder</TableColumnHeader>
                <TableColumnHeader>Projects</TableColumnHeader>
                <TableColumnHeader>Required</TableColumnHeader>
                <TableColumnHeader style={{ width: 75 }}></TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customFields?.length && items?.length ? (
                <SortableContext
                  items={items}
                  strategy={verticalListSortingStrategy}
                >
                  {items.map((v) => {
                    return (
                      <SortableCustomFieldRow
                        key={v.id}
                        customField={v}
                        deleteCustomField={deleteCustomField}
                        setEditModal={setModalOpen}
                      />
                    );
                  })}
                </SortableContext>
              ) : (
                <>
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-gray">
                      <em>
                        No custom fields defined{" "}
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setModalOpen({});
                          }}
                        >
                          Add custom field
                        </a>
                      </em>
                    </TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
          <DragOverlay>
            {activeId && selectedRow && (
              <Table variant="standard" style={{ width: "100%" }} className="appbox">
                <TableBody>
                  <StaticCustomFieldRow customField={selectedRow} />
                </TableBody>
              </Table>
            )}
          </DragOverlay>
        </DndContext>
      </div>
      {modalOpen && (
        <CustomFieldModal
          existing={modalOpen}
          section={section}
          close={() => setModalOpen(null)}
          onSuccess={mutateDefinitions}
        />
      )}
    </>
  );
};

export default CustomFields;

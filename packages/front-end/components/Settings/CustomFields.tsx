import React, { FC, useEffect, useMemo, useState } from "react";
import { CustomField, CustomFieldSection } from "back-end/types/organization";
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
import usePermissions from "@/hooks/usePermissions";
import { useCustomFields } from "@/services/experiments";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import track from "@/services/track";
import { GBEdit } from "@/components/Icons";
import {
  SortableCustomFieldRow,
  StaticCustomFieldRow,
} from "@/components/Experiment/SortableCustomField";
import CustomFieldModal from "@/components/Settings/CustomFieldModal";

const CustomFields: FC<{
  section: CustomFieldSection;
  title: string;
}> = ({ section, title }) => {
  const [modalOpen, setModalOpen] = useState<Partial<CustomField> | null>(null);
  const permissions = usePermissions();
  const customFields = useCustomFields();
  const { apiCall } = useAuth();
  const { refreshOrganization, updateUser } = useUser();
  const [activeId, setActiveId] = useState();
  const [items, setItems] = useState(
    customFields?.filter((x) => x.section === section)
  );
  console.log(section, customFields, items);
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
    const newCustomFields = items
      ? [...items].filter((x) => x.id !== customField.id)
      : [];
    await apiCall(`/organization`, {
      method: "PUT",
      body: JSON.stringify({
        settings: {
          customFields: newCustomFields,
        },
      }),
    }).then(() => {
      track("Delete Custom Experiment Field", {
        type: customField.type,
      });
      refreshOrganization();
    });
  };

  const sensors = useSensors(
    useSensor(MouseSensor, {}),
    useSensor(TouchSensor, {}),
    useSensor(KeyboardSensor, {})
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
        await apiCall(`/organization`, {
          method: "PUT",
          body: JSON.stringify({
            settings: {
              customFields: newItems,
            },
          }),
        }).then(() => {
          updateUser();
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
            <p className="text-gray"></p>
          </div>
          <div style={{ flex: 1 }} />
          {permissions.manageCustomFields && (
            <div className="col-auto">
              <button
                className="btn btn-primary float-right"
                onClick={() => {
                  setModalOpen({});
                }}
              >
                <span className="h4 pr-2 m-0 d-inline-block align-top">
                  <GBEdit />
                </span>
                Add Custom Field
              </button>
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
          <table className="table gbtable appbox">
            <thead>
              <tr>
                <th style={{ width: "30px" }}></th>
                <th>Field Name</th>
                <th>Description</th>
                <th>Type</th>
                <th>Default value</th>
                <th>Projects</th>
                <th>Required</th>
                <th style={{ width: 75 }}></th>
              </tr>
            </thead>
            <tbody>
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
                  <tr>
                    <td colSpan={6} className="text-center text-gray">
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
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
          <DragOverlay>
            {activeId && selectedRow && (
              <table style={{ width: "100%" }} className="table gbtable appbox">
                <tbody>
                  <StaticCustomFieldRow customField={selectedRow} />
                </tbody>
              </table>
            )}
          </DragOverlay>
        </DndContext>
      </div>
      {modalOpen && (
        <CustomFieldModal
          existing={modalOpen}
          section={section}
          close={() => setModalOpen(null)}
          onSuccess={refreshOrganization}
        />
      )}
    </>
  );
};

export default CustomFields;

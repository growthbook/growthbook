import React, { useEffect, useMemo, useState } from "react";
import { CustomField } from "back-end/types/organization";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
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
import { useUser } from "@/services/UserContext";
import { useCustomFields } from "@/services/experiments";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import {
  SortableCustomFieldRow,
  StaticCustomFieldRow,
} from "@/components/Experiment/SortableCustomField";
import usePermissions from "../../hooks/usePermissions";
import { GBEdit } from "../../components/Icons";
import CustomFieldModal from "../../components/Settings/CustomFieldModal";

const CustomFieldsPage = (): React.ReactElement => {
  const [modalOpen, setModalOpen] = useState<Partial<CustomField> | null>(null);
  const permissions = usePermissions();
  const customFields = useCustomFields();
  const { apiCall } = useAuth();
  const { refreshOrganization, license, updateUser } = useUser();
  const [activeId, setActiveId] = useState();
  const [items, setItems] = useState(customFields);

  useEffect(() => {
    setItems(customFields);
  }, [customFields]);

  const selectedRow = useMemo(() => {
    if (!activeId) {
      return null;
    }
    return items.find((cf) => cf.id === activeId);
  }, [activeId, items]);

  const deleteCustomField = async (customField: CustomField) => {
    const newCustomFields = [...items].filter((x) => x.id !== customField.id);
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
    const { active, over } = event;
    if (active.id !== over.id) {
      // it moved:
      const oldIndex = items.findIndex((x) => x.id === active.id);
      const newIndex = items.findIndex((x) => x.id === over.id);
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

    setActiveId(null);
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  if (!license) {
    return (
      <div className="contents container-fluid pagecontents">
        <div className="mb-5">
          <div className="row mb-3 align-items-center">
            <div className="col-auto">
              <h3>Custom Experiment Fields</h3>
              <p className="text-gray"></p>
            </div>
          </div>
          <div className="row mb-3">
            <div className="col-auto mb-2 alert alert-info py-2">
              Custom experiment fields are available for enterprise plans.
              Please upgrade your plan to access this feature.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="contents container-fluid pagecontents">
        <div className="mb-5">
          <div className="row mb-3 align-items-center">
            <div className="col-auto">
              <h3>Custom Experiment Fields</h3>
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
                  <th>Field Description</th>
                  <th>Field Type</th>
                  <th>Projects</th>
                  <th>Required</th>
                  <th style={{ width: 75 }}></th>
                </tr>
              </thead>
              <tbody>
                {customFields?.length ? (
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
                      <td colSpan={3} className="text-center text-gray">
                        <em>
                          No attributes defined{" "}
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
              {activeId && (
                <table
                  style={{ width: "100%" }}
                  className="table gbtable appbox"
                >
                  <tbody>
                    <StaticCustomFieldRow customField={selectedRow} />
                  </tbody>
                </table>
              )}
            </DragOverlay>
          </DndContext>
        </div>
      </div>
      {modalOpen && (
        <CustomFieldModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={refreshOrganization}
        />
      )}
    </>
  );
};

export default CustomFieldsPage;

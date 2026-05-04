import { FC, useEffect, useMemo, useState } from "react";
import { CustomField, CustomFieldSection } from "shared/types/custom-fields";
import { ALL_SECTIONS } from "shared/validators";
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
import { Box } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import {
  CUSTOM_FIELD_TABLE_WIDTHS,
  SortableCustomFieldRow,
  StaticCustomFieldRow,
} from "@/components/CustomFields/SortableCustomField";
import CustomFieldModal from "@/components/CustomFields/CustomFieldModal";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import useURLHash from "@/hooks/useURLHash";

export type AppliesToFilter = "all" | CustomFieldSection;
export { CUSTOM_FIELD_SECTION_LABELS } from "@/components/CustomFields/constants";

/** FE-only: array index for delete disambiguation (legacy duplicate ids) */
export type CustomFieldWithArrayIndex = CustomField & { arrayIndex: number };

function CustomFieldsTable({
  filter,
  items,
  duplicateIds,
  showRequired,
  deleteCustomField,
  toggleCustomField,
  setModalOpen,
  handleMoveUp,
  handleMoveDown,
  canManage,
}: {
  filter: AppliesToFilter;
  items: CustomFieldWithArrayIndex[];
  duplicateIds: Set<string>;
  showRequired: boolean;
  deleteCustomField: (cf: CustomFieldWithArrayIndex) => Promise<void>;
  toggleCustomField: (cf: CustomFieldWithArrayIndex) => Promise<void>;
  setModalOpen: (v: Partial<CustomField> | null) => void;
  handleMoveUp: (moveId: string, aboveId: string) => void;
  handleMoveDown: (moveId: string, belowId: string) => void;
  canManage: boolean;
}) {
  const W = CUSTOM_FIELD_TABLE_WIDTHS;
  const colSpan = 7 + 1 + (showRequired ? 1 : 0); // +1 for menu

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((cf) => cf.sections?.includes(filter));
  }, [items, filter]);

  const openAddModal = () =>
    setModalOpen(
      filter === "all" ? {} : { sections: [filter as CustomFieldSection] },
    );

  return (
    <table
      className="table gbtable table-valign-top"
      style={{ tableLayout: "fixed", width: "100%" }}
    >
      <colgroup>
        <col style={{ width: W.dragHandle }} />
        <col style={{ width: W.name }} />
        <col style={{ width: W.key }} />
        <col style={{ width: W.description }} />
        <col style={{ width: W.appliesTo }} />
        <col style={{ width: W.valueType }} />
        <col style={{ width: W.projects }} />
        {showRequired && <col style={{ width: W.required }} />}
        <col style={{ width: W.menu }} />
      </colgroup>
      <thead>
        <tr>
          <th style={{ padding: "0.5rem 0", textAlign: "center" }} />
          <th>Field Name</th>
          <th>Field Key</th>
          <th>Description</th>
          <th>Applies To</th>
          <th>Value Type</th>
          <th>Projects</th>
          {showRequired && <th>Required</th>}
          <th style={{ padding: "0.5rem 0", textAlign: "center" }} />
        </tr>
      </thead>
      <tbody>
        {filteredItems.length > 0 ? (
          <SortableContext
            items={filteredItems}
            strategy={verticalListSortingStrategy}
          >
            {filteredItems.map((v, filteredIndex) => (
              <SortableCustomFieldRow
                key={`${v.id}-${v.arrayIndex}`}
                customField={v}
                deleteCustomField={deleteCustomField}
                toggleCustomField={toggleCustomField}
                setEditModal={setModalOpen}
                canMoveUp={filteredIndex > 0}
                canMoveDown={filteredIndex < filteredItems.length - 1}
                onMoveUp={() =>
                  handleMoveUp(v.id, filteredItems[filteredIndex - 1]!.id)
                }
                onMoveDown={() =>
                  handleMoveDown(v.id, filteredItems[filteredIndex + 1]!.id)
                }
                canManage={canManage}
                showRequired={showRequired}
                isDuplicateId={duplicateIds.has(v.id)}
              />
            ))}
          </SortableContext>
        ) : (
          <tr>
            <td colSpan={colSpan} className="text-center text-gray">
              <em>
                No custom fields in this view.{" "}
                {canManage ? (
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      openAddModal();
                    }}
                  >
                    Add custom field
                  </a>
                ) : null}
              </em>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

const TAB_VALUES = ["all", "feature", "experiment"] as const;

const CustomFields: FC = () => {
  const [activeFilter, setActiveFilter] = useURLHash(TAB_VALUES);
  const [modalOpen, setModalOpen] = useState<Partial<CustomField> | null>(null);
  const { customFields, mutateDefinitions } = useDefinitions();
  const { apiCall } = useAuth();
  const [activeId, setActiveId] = useState<string | undefined>();
  const [items, setItems] = useState<CustomFieldWithArrayIndex[]>(() =>
    (customFields ?? []).map((cf, i) => ({ ...cf, arrayIndex: i })),
  );
  const permissionsUtils = usePermissionsUtil();

  useEffect(() => {
    setItems((customFields ?? []).map((cf, i) => ({ ...cf, arrayIndex: i })));
  }, [customFields]);

  const selectedRow = useMemo(() => {
    if (!activeId) return null;
    return items?.find((cf) => cf.id === activeId) ?? null;
  }, [activeId, items]);

  const deleteCustomField = async (customField: CustomFieldWithArrayIndex) => {
    await apiCall(
      `/custom-fields/${customField.id}?index=${customField.arrayIndex}`,
      {
        method: "DELETE",
      },
    ).then(() => {
      track("Delete Custom Field", { type: customField.type });
      mutateDefinitions();
    });
  };

  const toggleCustomField = async (customField: CustomFieldWithArrayIndex) => {
    await apiCall(`/custom-fields/${customField.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: customField.name,
        description: customField.description,
        placeholder: customField.placeholder,
        defaultValue: customField.defaultValue,
        values: customField.values,
        required: customField.required,
        projects: customField.projects,
        sections: customField.sections,
        active: (customField.active ?? true) === false,
      }),
    }).then(() => mutateDefinitions());
  };

  const reorderFields = async (oldId: string, newId: string) => {
    await apiCall(`/custom-fields/reorder`, {
      method: "POST",
      body: JSON.stringify({ oldId, newId }),
    }).then(() => mutateDefinitions());
  };

  const sensors = useSensors(
    useSensor(MouseSensor, {}),
    useSensor(TouchSensor, {}),
    useSensor(KeyboardSensor, {}),
  );

  function handleDragStart(event: { active: { id: string } }) {
    setActiveId(event.active.id);
  }

  async function handleDragEnd(event: {
    active: { id: string };
    over: { id: string } | null;
  }) {
    if (!items) {
      setActiveId(undefined);
      return;
    }
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((x) => x.id === active.id);
      const newIndex = items.findIndex((x) => x.id === over.id);
      if (oldIndex >= 0 && newIndex >= 0) {
        const reordered = arrayMove(items, oldIndex, newIndex);
        setItems(reordered.map((cf, i) => ({ ...cf, arrayIndex: i })));
        await reorderFields(String(active.id), String(over.id));
      }
    }
    setActiveId(undefined);
  }

  function handleDragCancel() {
    setActiveId(undefined);
  }

  const handleMoveUp = (moveId: string, aboveId: string) =>
    reorderFields(moveId, aboveId);

  const handleMoveDown = (moveId: string, belowId: string) =>
    reorderFields(moveId, belowId);

  const canManage = permissionsUtils.canManageCustomFields();

  const duplicateIds = useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const cf of items) {
      if (seen.has(cf.id)) dupes.add(cf.id);
      else seen.add(cf.id);
    }
    return dupes;
  }, [items]);

  return (
    <>
      <Box mt="4" mb="5">
        <div className="row align-items-center mb-1">
          <div className="col-auto">
            <h2 className="mb-0">Custom Fields</h2>
          </div>
          <div className="flex-1" />
          {canManage && (
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
        <p className="text-gray mb-4">
          Add custom metadata to feature flags and experiments. Choose whether
          each field applies to Features, Experiments, or both.
        </p>
        <DndContext
          sensors={sensors}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
          onDragCancel={handleDragCancel}
          collisionDetection={closestCenter}
        >
          <Tabs
            value={activeFilter ?? "all"}
            onValueChange={(v) => setActiveFilter(v as AppliesToFilter)}
          >
            <Box mb="4">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="feature">Feature</TabsTrigger>
                <TabsTrigger value="experiment">Experiment</TabsTrigger>
              </TabsList>
            </Box>
            <TabsContent value="all">
              <Box className="appbox">
                <CustomFieldsTable
                  filter="all"
                  items={items}
                  duplicateIds={duplicateIds}
                  showRequired={true}
                  deleteCustomField={deleteCustomField}
                  toggleCustomField={toggleCustomField}
                  setModalOpen={setModalOpen}
                  handleMoveUp={handleMoveUp}
                  handleMoveDown={handleMoveDown}
                  canManage={canManage}
                />
              </Box>
            </TabsContent>
            <TabsContent value="feature">
              <Box className="appbox">
                <CustomFieldsTable
                  filter="feature"
                  items={items}
                  duplicateIds={duplicateIds}
                  showRequired={true}
                  deleteCustomField={deleteCustomField}
                  toggleCustomField={toggleCustomField}
                  setModalOpen={setModalOpen}
                  handleMoveUp={handleMoveUp}
                  handleMoveDown={handleMoveDown}
                  canManage={canManage}
                />
              </Box>
            </TabsContent>
            <TabsContent value="experiment">
              <Box className="appbox">
                <CustomFieldsTable
                  filter="experiment"
                  items={items}
                  duplicateIds={duplicateIds}
                  showRequired={true}
                  deleteCustomField={deleteCustomField}
                  toggleCustomField={toggleCustomField}
                  setModalOpen={setModalOpen}
                  handleMoveUp={handleMoveUp}
                  handleMoveDown={handleMoveDown}
                  canManage={canManage}
                />
              </Box>
            </TabsContent>
          </Tabs>
          <DragOverlay>
            {activeId && selectedRow ? (
              <table style={{ width: "100%" }} className="table gbtable">
                <tbody>
                  <StaticCustomFieldRow
                    customField={selectedRow}
                    showRequired={true}
                  />
                </tbody>
              </table>
            ) : null}
          </DragOverlay>
        </DndContext>
      </Box>
      {modalOpen !== null && (
        <CustomFieldModal
          existing={modalOpen}
          defaultSections={
            modalOpen.sections ??
            (activeFilter === "all"
              ? [...ALL_SECTIONS]
              : [activeFilter as CustomFieldSection])
          }
          close={() => setModalOpen(null)}
          onSuccess={mutateDefinitions}
        />
      )}
    </>
  );
};

export default CustomFields;

import React, { FC, useEffect, useMemo, useState } from "react";
import { CustomField, CustomFieldSection } from "shared/types/custom-fields";
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
import { Box, Flex } from "@radix-ui/themes";
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
import Heading from "@/ui/Heading";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import useURLHash from "@/hooks/useURLHash";

export type AppliesToFilter = "all" | CustomFieldSection;

function CustomFieldsTable({
  filter,
  items,
  showAppliesTo,
  showRequired,
  deleteCustomField,
  setModalOpen,
  handleMoveUp,
  handleMoveDown,
  canManage,
}: {
  filter: AppliesToFilter;
  items: CustomField[];
  showAppliesTo: boolean;
  showRequired: boolean;
  deleteCustomField: (cf: CustomField) => Promise<void>;
  setModalOpen: (v: Partial<CustomField> | null) => void;
  handleMoveUp: (moveId: string, aboveId: string) => void;
  handleMoveDown: (moveId: string, belowId: string) => void;
  canManage: boolean;
}) {
  const W = CUSTOM_FIELD_TABLE_WIDTHS;
  const colSpan = 7 + (showAppliesTo ? 1 : 0) + (showRequired ? 1 : 0);

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((cf) => cf.section === filter);
  }, [items, filter]);

  const openAddModal = () =>
    setModalOpen(
      filter === "all" ? {} : { section: filter as CustomFieldSection },
    );

  return (
    <Table
      variant="list"
      stickyHeader={false}
      roundedCorners
      style={{ tableLayout: "fixed", width: "100%" }}
    >
      <TableHeader>
        <TableRow>
          <TableColumnHeader
            style={{
              width: W.dragHandle,
              minWidth: W.dragHandle,
              padding: "0.5rem 0",
              textAlign: "center",
            }}
          />
          <TableColumnHeader style={{ width: W.name }}>
            Field Name
          </TableColumnHeader>
          <TableColumnHeader style={{ width: W.key }}>
            Field Key
          </TableColumnHeader>
          <TableColumnHeader style={{ width: W.description }}>
            Description
          </TableColumnHeader>
          {showAppliesTo && (
            <TableColumnHeader style={{ width: W.appliesTo }}>
              Applies To
            </TableColumnHeader>
          )}
          <TableColumnHeader>Value Type</TableColumnHeader>
          <TableColumnHeader style={{ width: W.projects }}>
            Projects
          </TableColumnHeader>
          {showRequired && (
            <TableColumnHeader style={{ width: W.required }}>
              Required
            </TableColumnHeader>
          )}
          <TableColumnHeader
            style={{
              width: W.menu,
              minWidth: W.menu,
              padding: "0.5rem 0",
              textAlign: "center",
            }}
          />
        </TableRow>
      </TableHeader>
      <TableBody>
        {filteredItems.length > 0 ? (
          <SortableContext
            items={filteredItems}
            strategy={verticalListSortingStrategy}
          >
            {filteredItems.map((v, index) => (
              <SortableCustomFieldRow
                key={v.id}
                customField={v}
                deleteCustomField={deleteCustomField}
                setEditModal={setModalOpen}
                canMoveUp={index > 0}
                canMoveDown={index < filteredItems.length - 1}
                onMoveUp={() =>
                  handleMoveUp(v.id, filteredItems[index - 1]!.id)
                }
                onMoveDown={() =>
                  handleMoveDown(v.id, filteredItems[index + 1]!.id)
                }
                canManage={canManage}
                showAppliesTo={showAppliesTo}
                showRequired={showRequired}
              />
            ))}
          </SortableContext>
        ) : (
          <TableRow>
            <TableCell
              colSpan={colSpan}
              className="text-gray"
              style={{ textAlign: "center" }}
            >
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
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

const TAB_VALUES = ["all", "feature", "experiment"] as const;

const CustomFields: FC = () => {
  const [activeFilter] = useURLHash(TAB_VALUES as unknown as string[]);
  const [modalOpen, setModalOpen] = useState<Partial<CustomField> | null>(null);
  const { customFields, mutateDefinitions } = useDefinitions();
  const { apiCall } = useAuth();
  const [activeId, setActiveId] = useState<string | undefined>();
  const [items, setItems] = useState<CustomField[]>(customFields ?? []);
  const permissionsUtils = usePermissionsUtil();

  useEffect(() => {
    setItems(customFields ?? []);
  }, [customFields]);

  const selectedRow = useMemo(() => {
    if (!activeId) return null;
    return items?.find((cf) => cf.id === activeId) ?? null;
  }, [activeId, items]);

  const deleteCustomField = async (customField: CustomField) => {
    await apiCall(`/custom-fields/${customField.id}`, {
      method: "DELETE",
    }).then(() => {
      track("Delete Custom Field", { type: customField.type });
      mutateDefinitions();
    });
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
        const newItems = arrayMove(items, oldIndex, newIndex);
        setItems(newItems);
        await reorderFields(String(active.id), String(over.id));
      }
    }
    setActiveId(undefined);
  }

  function handleDragCancel() {
    setActiveId(undefined);
  }

  const handleMoveUp = (moveId: string, aboveId: string) => {
    reorderFields(moveId, aboveId);
  };

  const handleMoveDown = (moveId: string, belowId: string) => {
    reorderFields(moveId, belowId);
  };

  const canManage = permissionsUtils.canManageCustomFields();

  return (
    <>
      <Box mt="4" mb="5">
        <Flex align="center" justify="between" mb="1" gap="3" wrap="wrap">
          <Heading as="h2">Custom Fields</Heading>
          {canManage ? (
            <Button
              onClick={() => {
                setModalOpen({});
              }}
            >
              Add Custom Field
            </Button>
          ) : null}
        </Flex>
        <Box mb="4" style={{ color: "var(--gray-11)" }}>
          <p style={{ margin: 0 }}>
            Add custom metadata to feature flags and experiments. Choose whether
            each field applies to features, experiments, or both (separate
            entries).
          </p>
        </Box>
        <DndContext
          sensors={sensors}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
          onDragCancel={handleDragCancel}
          collisionDetection={closestCenter}
        >
          <Tabs defaultValue="all" persistInURL={true}>
            <Box mb="4">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="feature">Feature</TabsTrigger>
                <TabsTrigger value="experiment">Experiment</TabsTrigger>
              </TabsList>
            </Box>
            <TabsContent value="all">
              <Box>
                <CustomFieldsTable
                  filter="all"
                  items={items}
                  showAppliesTo={true}
                  showRequired={true}
                  deleteCustomField={deleteCustomField}
                  setModalOpen={setModalOpen}
                  handleMoveUp={handleMoveUp}
                  handleMoveDown={handleMoveDown}
                  canManage={canManage}
                />
              </Box>
            </TabsContent>
            <TabsContent value="feature">
              <Box>
                <CustomFieldsTable
                  filter="feature"
                  items={items}
                  showAppliesTo={false}
                  showRequired={true}
                  deleteCustomField={deleteCustomField}
                  setModalOpen={setModalOpen}
                  handleMoveUp={handleMoveUp}
                  handleMoveDown={handleMoveDown}
                  canManage={canManage}
                />
              </Box>
            </TabsContent>
            <TabsContent value="experiment">
              <Box>
                <CustomFieldsTable
                  filter="experiment"
                  items={items}
                  showAppliesTo={false}
                  showRequired={true}
                  deleteCustomField={deleteCustomField}
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
                    showAppliesTo={true}
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
          section={
            modalOpen.section ??
            (activeFilter === "all"
              ? "feature"
              : (activeFilter as CustomFieldSection))
          }
          close={() => setModalOpen(null)}
          onSuccess={mutateDefinitions}
        />
      )}
    </>
  );
};

export default CustomFields;

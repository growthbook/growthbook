import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiPlusBold, PiCaretDown, PiCaretUp } from "react-icons/pi";
import { BsThreeDotsVertical } from "react-icons/bs";
import { RiDraggable } from "react-icons/ri";
import { HiBadgeCheck } from "react-icons/hi";
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
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { FeatureInterface } from "shared/types/feature";
import { RampScheduleTemplateInterface } from "shared/validators";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";
import { useUser } from "@/services/UserContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import Frame from "@/ui/Frame";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import MonitoredIcon from "@/components/Features/RuleModal/MonitoredIcon";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import RampScheduleSection, {
  defaultRampSectionState,
  buildTemplatePayload,
  templateToSectionState,
  formatRampStepSummary,
  isMonitoredTemplate,
  type RampSectionState,
} from "@/components/Features/RuleModal/RampScheduleSection";

// Minimal generic feature used when editing templates (no real feature context).
const GENERIC_FEATURE: Pick<FeatureInterface, "id" | "valueType" | "project"> =
  {
    id: "",
    valueType: "json",
    project: "",
  };

const DRAG_HANDLE_WIDTH = 40;
const MONITORED_WIDTH = 110;
const MENU_WIDTH = 50;

interface EditModalProps {
  template?: RampScheduleTemplateInterface;
  entityType: "feature" | "experiment";
  onClose: () => void;
  onSave: () => void;
}

function EditModal({ template, entityType, onClose, onSave }: EditModalProps) {
  const { apiCall } = useAuth();
  const environments = useEnvironments();
  // Experiment templates author their steps in the experiment ramp modal
  // ("Save as template"); here they only support renaming + the official flag.
  // Feature templates use the full embedded ramp editor.
  const isExperiment = entityType === "experiment";
  const [name, setName] = useState(template?.name ?? "");
  const [official, setOfficial] = useState(template?.official ?? false);
  const [saving, setSaving] = useState(false);
  const [rampState, setRampState] = useState<RampSectionState>(() => {
    if (template && !isExperiment) {
      return templateToSectionState(template, "edit");
    }
    const s = defaultRampSectionState(undefined);
    return { ...s, mode: "create" };
  });

  return (
    <Modal
      open
      trackingEventModalType="ramp-schedule-template-edit"
      close={onClose}
      header={template ? "Edit Template" : "New Template"}
      loading={saving}
      ctaEnabled={!!name.trim()}
      submit={async () => {
        setSaving(true);
        try {
          // Experiment templates: only name/official are editable here — steps
          // are untouched. Feature templates rebuild the full payload.
          const payload = isExperiment
            ? { name: name.trim(), official }
            : {
                ...buildTemplatePayload({ ...rampState, name }),
                name: name.trim(),
                official,
              };
          if (template) {
            await apiCall(`/ramp-schedule-templates/${template.id}`, {
              method: "PUT",
              body: JSON.stringify(payload),
            });
          } else {
            await apiCall("/ramp-schedule-templates", {
              method: "POST",
              body: JSON.stringify({ ...payload, entityType }),
            });
          }
          onSave();
        } finally {
          setSaving(false);
        }
      }}
      cta="Save"
      size="lg"
    >
      <Box mb="5">
        <Field
          label="Template name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </Box>
      <Box mb="5">
        <Checkbox
          label="Official template"
          value={official}
          setValue={setOfficial}
          description="Eligible to be used as the editor default for new ramps"
        />
      </Box>
      {isExperiment ? (
        template ? (
          <Box>
            <Text as="div" weight="medium" mb="1">
              Steps
            </Text>
            <Text color="text-low" size="small">
              {formatRampStepSummary(template.steps)}
            </Text>
            <Text as="div" color="text-low" size="small" mt="2">
              Edit steps from an experiment&apos;s ramp schedule, then use
              &ldquo;Save as template&rdquo;.
            </Text>
          </Box>
        ) : null
      ) : (
        <RampScheduleSection
          ruleRampSchedule={undefined}
          state={rampState}
          setState={setRampState}
          embedded
          hideNameField
          hideTemplateSave
          feature={GENERIC_FEATURE as FeatureInterface}
          environments={environments.map((e) => e.id)}
        />
      )}
    </Modal>
  );
}

interface TemplateRowMenuProps {
  canEdit: boolean;
  canDelete: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function TemplateRowMenu({
  canEdit,
  canDelete,
  canMoveUp,
  canMoveDown,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: TemplateRowMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu
      trigger={
        <IconButton
          variant="ghost"
          color="gray"
          radius="full"
          size="2"
          highContrast
          style={{ margin: 0 }}
        >
          <BsThreeDotsVertical size={18} />
        </IconButton>
      }
      open={open}
      onOpenChange={setOpen}
      menuPlacement="end"
      variant="soft"
    >
      <DropdownMenuGroup>
        {canEdit && (
          <DropdownMenuItem
            onClick={() => {
              onEdit();
              setOpen(false);
            }}
          >
            Edit
          </DropdownMenuItem>
        )}
        {canDelete && (
          <DropdownMenuItem
            color="red"
            confirmation={{
              submit: onDelete,
              confirmationTitle: "Delete Template",
              cta: "Delete",
              getConfirmationContent: async () =>
                "Are you sure? This action cannot be undone.",
            }}
          >
            Delete
          </DropdownMenuItem>
        )}
        {(canMoveUp || canMoveDown) && <DropdownMenuSeparator />}
        {(canMoveUp || canMoveDown) && (
          <>
            <DropdownMenuItem
              disabled={!canMoveUp}
              onClick={() => {
                if (canMoveUp) {
                  onMoveUp();
                  setOpen(false);
                }
              }}
            >
              <PiCaretUp /> Move up
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!canMoveDown}
              onClick={() => {
                if (canMoveDown) {
                  onMoveDown();
                  setOpen(false);
                }
              }}
            >
              <PiCaretDown /> Move down
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuGroup>
    </DropdownMenu>
  );
}

function TemplateRowCells({
  template,
  canUpdate,
  onEdit,
}: {
  template: RampScheduleTemplateInterface;
  canUpdate: boolean;
  onEdit: () => void;
}) {
  return (
    <>
      <TableCell>
        <Flex justify="between" align="center" gap="3">
          <Flex align="center" gap="1" style={{ minWidth: 0 }}>
            {template.official && (
              <HiBadgeCheck
                style={{
                  fontSize: "1.2em",
                  lineHeight: "1em",
                  marginTop: "-2px",
                  color: "var(--blue-11)",
                  flexShrink: 0,
                }}
              />
            )}
            {canUpdate ? (
              <Link onClick={onEdit} weight="medium">
                {template.name}
              </Link>
            ) : (
              <Text weight="medium" size="medium">
                {template.name}
              </Text>
            )}
          </Flex>
          <Text color="text-low" size="small">
            {formatRampStepSummary(template.steps)}
          </Text>
        </Flex>
      </TableCell>
      <TableCell style={{ width: MONITORED_WIDTH }}>
        {isMonitoredTemplate(template) && (
          <Flex justify="center">
            <MonitoredIcon size={16} />
          </Flex>
        )}
      </TableCell>
    </>
  );
}

interface SortableTemplateRowProps {
  template: RampScheduleTemplateInterface;
  canUpdate: boolean;
  canDelete: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function SortableTemplateRow({
  template,
  canUpdate,
  canDelete,
  canMoveUp,
  canMoveDown,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: SortableTemplateRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: template.id });
  const style: React.CSSProperties = {
    transition,
    ...(isDragging
      ? { opacity: 0, pointerEvents: "none" as const }
      : { transform: CSS.Transform.toString(transform), opacity: 1 }),
  };

  return (
    <TableRow ref={setNodeRef} style={style}>
      <TableCell style={{ width: DRAG_HANDLE_WIDTH }}>
        {canUpdate && (
          <Flex
            justify="center"
            style={{
              color: "var(--slate-a8)",
              cursor: isDragging ? "grabbing" : "grab",
            }}
            {...attributes}
            {...listeners}
          >
            <RiDraggable size={16} />
          </Flex>
        )}
      </TableCell>
      <TemplateRowCells
        template={template}
        canUpdate={canUpdate}
        onEdit={onEdit}
      />
      <TableCell style={{ width: MENU_WIDTH }}>
        <Flex justify="center">
          <TemplateRowMenu
            canEdit={canUpdate}
            canDelete={canDelete}
            canMoveUp={canUpdate && canMoveUp}
            canMoveDown={canUpdate && canMoveDown}
            onEdit={onEdit}
            onDelete={onDelete}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
          />
        </Flex>
      </TableCell>
    </TableRow>
  );
}

function StaticTemplateRow({
  template,
}: {
  template: RampScheduleTemplateInterface;
}) {
  return (
    <TableRow style={{ opacity: 0.85 }}>
      <TableCell style={{ width: DRAG_HANDLE_WIDTH }}>
        <Flex justify="center" style={{ color: "var(--slate-a8)" }}>
          <RiDraggable size={16} />
        </Flex>
      </TableCell>
      <TemplateRowCells
        template={template}
        canUpdate={false}
        onEdit={() => undefined}
      />
      <TableCell style={{ width: MENU_WIDTH }} />
    </TableRow>
  );
}

export default function RampScheduleTemplates({
  entityType = "feature",
}: {
  entityType?: "feature" | "experiment";
}) {
  const { data, mutate } = useApi<{
    rampScheduleTemplates: RampScheduleTemplateInterface[];
  }>("/ramp-schedule-templates");
  const { apiCall } = useAuth();
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  const isExperiment = entityType === "experiment";
  const hasFeature = hasCommercialFeature("ramp-schedules");
  // Gate on the matching entity's permissions: experiment templates use
  // experiment (createAnalyses) permissions, feature templates use feature ones.
  const canCreate =
    hasFeature &&
    (isExperiment
      ? permissionsUtil.canCreateExperiment({ project: undefined })
      : permissionsUtil.canCreateFeature({ project: undefined }));
  const canUpdate =
    hasFeature &&
    (isExperiment
      ? permissionsUtil.canUpdateExperiment(
          { project: undefined },
          { project: undefined },
        )
      : permissionsUtil.canUpdateFeature(
          { project: undefined },
          { project: undefined },
        ));
  const canDelete =
    hasFeature &&
    (isExperiment
      ? permissionsUtil.canDeleteExperiment({ project: undefined })
      : permissionsUtil.canDeleteFeature({ project: undefined }));

  const [editingTemplate, setEditingTemplate] = useState<
    RampScheduleTemplateInterface | null | false
  >(false);
  const [activeId, setActiveId] = useState<string | undefined>();
  // Templates with no entityType predate the discriminator and are features.
  const matchesEntity = useCallback(
    (t: RampScheduleTemplateInterface) =>
      (t.entityType ?? "feature") === entityType,
    [entityType],
  );

  // Local mirror of the server list so reorders feel instant before refetch.
  const [items, setItems] = useState<RampScheduleTemplateInterface[]>(
    (data?.rampScheduleTemplates ?? []).filter(matchesEntity),
  );

  useEffect(() => {
    setItems((data?.rampScheduleTemplates ?? []).filter(matchesEntity));
  }, [data, matchesEntity]);

  const sensors = useSensors(
    useSensor(MouseSensor, {}),
    useSensor(TouchSensor, {}),
    useSensor(KeyboardSensor, {}),
  );

  const activeTemplate = useMemo(
    () => items.find((t) => t.id === activeId) ?? null,
    [activeId, items],
  );

  // Move `oldId` into `newId`'s slot. Shared by drag-and-drop and the Move
  // up/down menu so both update the list immediately, then revert if the persist
  // fails — the table never shows an order the server didn't accept.
  const moveTemplate = async (oldId: string, newId: string) => {
    const oldIndex = items.findIndex((t) => t.id === oldId);
    const newIndex = items.findIndex((t) => t.id === newId);
    if (oldIndex < 0 || newIndex < 0) return;
    const previous = items;
    setItems(arrayMove(items, oldIndex, newIndex));
    try {
      await apiCall(`/ramp-schedule-templates/reorder`, {
        method: "POST",
        body: JSON.stringify({ oldId, newId }),
      });
      await mutate();
    } catch {
      setItems(previous);
    }
  };

  async function handleDragEnd(event: {
    active: { id: string };
    over: { id: string } | null;
  }) {
    const { active, over } = event;
    setActiveId(undefined);
    if (!over || active.id === over.id) return;
    await moveTemplate(String(active.id), String(over.id));
  }

  const deleteTemplate = async (template: RampScheduleTemplateInterface) => {
    await apiCall(`/ramp-schedule-templates/${template.id}`, {
      method: "DELETE",
    });
    await mutate();
  };

  return (
    <Frame>
      <Flex justify="between" align="center" mb="3">
        <Heading as="h3" size="small">
          Ramp Schedule Templates
        </Heading>
        {/* Experiment templates are authored from an experiment's ramp
            schedule ("Save as template"), so there's no create button here. */}
        {!isExperiment && (
          <PremiumTooltip commercialFeature="ramp-schedules">
            <Button
              variant="outline"
              onClick={() => canCreate && setEditingTemplate(null)}
              disabled={!canCreate}
            >
              <PiPlusBold style={{ marginRight: 4, verticalAlign: "middle" }} />
              New template
            </Button>
          </PremiumTooltip>
        )}
      </Flex>

      {items.length === 0 ? (
        <Text color="text-low" size="medium">
          No templates yet.{" "}
          {!hasFeature
            ? "Upgrade to Enterprise to create and manage ramp schedule templates."
            : isExperiment
              ? "Configure a ramp on an experiment and use “Save as template” to create one."
              : "Create one to quickly apply standard ramp schedules to feature rules."}
        </Text>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={(e) => setActiveId(String(e.active.id))}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveId(undefined)}
          collisionDetection={closestCenter}
        >
          <Table variant="ghost">
            <TableHeader>
              <TableRow>
                <TableColumnHeader style={{ width: DRAG_HANDLE_WIDTH }} />
                <TableColumnHeader>Name</TableColumnHeader>
                <TableColumnHeader
                  style={{ width: MONITORED_WIDTH, textAlign: "center" }}
                >
                  Monitored
                </TableColumnHeader>
                <TableColumnHeader style={{ width: MENU_WIDTH }} />
              </TableRow>
            </TableHeader>
            <TableBody>
              <SortableContext
                items={items}
                strategy={verticalListSortingStrategy}
              >
                {items.map((tmpl, i) => (
                  <SortableTemplateRow
                    key={tmpl.id}
                    template={tmpl}
                    canUpdate={canUpdate}
                    canDelete={canDelete}
                    canMoveUp={i > 0}
                    canMoveDown={i < items.length - 1}
                    onEdit={() => setEditingTemplate(tmpl)}
                    onDelete={() => deleteTemplate(tmpl)}
                    onMoveUp={() => moveTemplate(tmpl.id, items[i - 1]!.id)}
                    onMoveDown={() => moveTemplate(tmpl.id, items[i + 1]!.id)}
                  />
                ))}
              </SortableContext>
            </TableBody>
          </Table>
          <DragOverlay>
            {activeId && activeTemplate ? (
              <Table variant="ghost">
                <TableBody>
                  <StaticTemplateRow template={activeTemplate} />
                </TableBody>
              </Table>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {editingTemplate !== false && (
        <EditModal
          template={editingTemplate ?? undefined}
          entityType={entityType}
          onClose={() => setEditingTemplate(false)}
          onSave={async () => {
            await mutate();
            setEditingTemplate(false);
          }}
        />
      )}
    </Frame>
  );
}

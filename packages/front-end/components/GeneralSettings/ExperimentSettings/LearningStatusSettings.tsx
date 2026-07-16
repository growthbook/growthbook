import React, { useMemo, useState } from "react";
import { useFormContext } from "react-hook-form";
import { Box, Flex } from "@radix-ui/themes";
import { PiPencilSimple, PiPlus, PiTrash } from "react-icons/pi";
import uniqid from "uniqid";
import { LearningStatus, LearningStatusColor } from "shared/types/organization";
import { DEFAULT_LEARNING_STATUSES } from "shared/constants";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import ConfirmModal from "@/components/ConfirmModal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";

const COLOR_OPTIONS: { label: string; value: LearningStatusColor }[] = [
  { label: "Gray", value: "gray" },
  { label: "Blue", value: "blue" },
  { label: "Cyan", value: "cyan" },
  { label: "Indigo", value: "indigo" },
  { label: "Violet", value: "violet" },
  { label: "Purple", value: "purple" },
  { label: "Amber", value: "amber" },
  { label: "Orange", value: "orange" },
  { label: "Yellow", value: "yellow" },
  { label: "Green", value: "green" },
  { label: "Teal", value: "teal" },
  { label: "Red", value: "red" },
  { label: "Pink", value: "pink" },
];

type EditState = {
  open: boolean;
  index: number | null; // null = creating new
  draft: LearningStatus;
};

const emptyDraft = (): LearningStatus => ({
  id: uniqid("lrnst_"),
  label: "",
  color: "gray",
});

const LearningStatusSettings: React.FC = () => {
  const form = useFormContext();
  // Read once, then memoize so an unset value doesn't churn array references
  // and re-trigger downstream useMemo hooks every render.
  const watchedStatuses = form.watch("learningStatuses");
  const statuses = useMemo<LearningStatus[]>(
    () => watchedStatuses ?? [],
    [watchedStatuses],
  );

  const [edit, setEdit] = useState<EditState>({
    open: false,
    index: null,
    draft: emptyDraft(),
  });
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);

  const labelDuplicate = useMemo(() => {
    if (!edit.open) return false;
    const lower = edit.draft.label.trim().toLowerCase();
    if (!lower) return false;
    return statuses.some(
      (s, i) => i !== edit.index && s.label.trim().toLowerCase() === lower,
    );
  }, [edit, statuses]);

  const setStatuses = (next: LearningStatus[]) => {
    form.setValue("learningStatuses", next, { shouldDirty: true });
  };

  const openCreate = () => {
    setEdit({ open: true, index: null, draft: emptyDraft() });
  };

  const openEdit = (index: number) => {
    const s = statuses[index];
    if (!s) return;
    setEdit({ open: true, index, draft: { ...s } });
  };

  const closeEdit = () => {
    setEdit({ open: false, index: null, draft: emptyDraft() });
  };

  const handleSave = () => {
    const label = edit.draft.label.trim();
    if (!label) return;
    const next = [...statuses];
    if (edit.index === null) {
      next.push({ ...edit.draft, label });
    } else {
      next[edit.index] = { ...edit.draft, label };
    }
    setStatuses(next);
    closeEdit();
  };

  const handleDelete = (index: number) => {
    const next = statuses.filter((_, i) => i !== index);
    setStatuses(next);
    setDeleteIndex(null);
  };

  const handleResetDefaults = () => {
    setStatuses(DEFAULT_LEARNING_STATUSES.map((s) => ({ ...s })));
  };

  const deleteTarget = deleteIndex !== null ? statuses[deleteIndex] : undefined;

  return (
    <Box className="appbox" p="3">
      <Flex justify="between" align="start" mb="3" gap="3" wrap="wrap">
        <Box>
          <Heading as="h3" size="small" weight="semibold" mb="1">
            Saved Learning Statuses
          </Heading>
          <Text size="small" color="text-mid">
            Configure the statuses available on saved learnings. Each learning
            can have one status, displayed as a badge next to its title. New
            learnings start with no status.
          </Text>
        </Box>
        <Flex gap="2" align="center">
          {statuses.length === 0 && (
            <Button variant="soft" size="sm" onClick={handleResetDefaults}>
              Restore defaults
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={openCreate}>
            <Flex align="center" gap="1">
              <PiPlus size={12} />
              <span>Add status</span>
            </Flex>
          </Button>
        </Flex>
      </Flex>

      {statuses.length === 0 ? (
        <Box py="3">
          <Text size="small" color="text-mid">
            No statuses configured. Add one above or restore the defaults
            (Emerging, Supported, Confirmed, Rejected).
          </Text>
        </Box>
      ) : (
        <Box>
          <Flex direction="column" gap="2">
            {statuses.map((s, i) => (
              <Flex
                key={s.id}
                justify="between"
                align="center"
                p="2"
                style={{
                  border: "1px solid var(--gray-a4)",
                  borderRadius: 6,
                  background: "var(--color-panel-solid)",
                }}
              >
                <Flex gap="3" align="center">
                  <Badge
                    label={s.label || "(unnamed)"}
                    color={s.color || "gray"}
                    variant="soft"
                    size="sm"
                  />
                </Flex>
                <Flex gap="1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(i)}
                    aria-label={`Edit status ${s.label}`}
                  >
                    <PiPencilSimple />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteIndex(i)}
                    aria-label={`Delete status ${s.label}`}
                  >
                    <PiTrash />
                  </Button>
                </Flex>
              </Flex>
            ))}
          </Flex>
        </Box>
      )}

      {edit.open && (
        <ModalStandard
          trackingEventModalType={
            edit.index === null
              ? "create-learning-status"
              : "edit-learning-status"
          }
          open={true}
          close={closeEdit}
          header={
            edit.index === null
              ? "Add status"
              : `Edit status: ${edit.draft.label}`
          }
          cta="Save"
          ctaEnabled={edit.draft.label.trim().length > 0 && !labelDuplicate}
          submit={async () => {
            handleSave();
          }}
        >
          <Box mb="3">
            <Field
              label="Label"
              value={edit.draft.label}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  draft: { ...edit.draft, label: e.target.value },
                })
              }
              required
              autoFocus
              error={
                labelDuplicate
                  ? "A status with this label already exists"
                  : undefined
              }
            />
          </Box>
          <Box mb="3">
            <SelectField
              label="Badge color"
              value={edit.draft.color || "gray"}
              options={COLOR_OPTIONS}
              onChange={(v) =>
                setEdit({
                  ...edit,
                  draft: {
                    ...edit.draft,
                    color: v as LearningStatusColor,
                  },
                })
              }
              sort={false}
            />
            <Flex mt="2" gap="2" align="center">
              <Text size="small" color="text-mid">
                Preview:
              </Text>
              <Badge
                label={edit.draft.label || "Preview"}
                color={edit.draft.color || "gray"}
                variant="soft"
                size="sm"
              />
            </Flex>
          </Box>
        </ModalStandard>
      )}

      <ConfirmModal
        title="Delete this status?"
        subtitle={
          deleteTarget
            ? `Delete the "${deleteTarget.label}" status? Saved learnings currently using it will fall back to showing the raw status id until they are updated.`
            : ""
        }
        yesText="Delete"
        noText="Cancel"
        modalState={deleteIndex !== null}
        setModalState={(open) => {
          if (!open) setDeleteIndex(null);
        }}
        onConfirm={async () => {
          if (deleteIndex !== null) handleDelete(deleteIndex);
        }}
      />
    </Box>
  );
};

export default LearningStatusSettings;

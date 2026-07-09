import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import {
  validateFeatureValue,
  getReviewSetting,
  filterEnvironmentsByFeature,
} from "shared/util";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiDotsSixVertical, PiPlus, PiTrash } from "react-icons/pi";
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAuth } from "@/services/auth";
import { getFeatureDefaultValue, useEnvironments } from "@/services/features";
import useOrgSettings from "@/hooks/useOrgSettings";
import DraftSelectorForChanges, {
  DraftMode,
} from "@/components/Features/DraftSelectorForChanges";
import { useDefaultDraft } from "@/hooks/useDefaultDraft";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import FeatureValueField from "./FeatureValueField";

export interface Props {
  feature: FeatureInterface;
  revisionList: MinimalFeatureRevisionInterface[];
  close: () => void;
  mutate: () => void;
  setVersion: (version: number) => void;
}

// A single override row in the form. `id` is a stable client key for drag/drop
// (the server assigns its own id on save, so this is throwaway).
type OverrideRow = {
  id: string;
  value: string;
  environments: string[];
};

type FormValues = {
  defaultValue: string;
  // Ordered list of overrides. On save, the compiler walks this list top-to-
  // bottom and serves the first entry whose scope matches the target env.
  overrides: OverrideRow[];
};

let rowCounter = 0;
const nextRowId = () => `row_${rowCounter++}`;

// Single editor for a feature's default value: the base value is primary, and
// per-environment overrides are an ordered, first-match-wins list below it
// (drag to reorder). Both are persisted through one draft revision
// (POST /feature/:id/:version/defaultvalue).
export default function EditDefaultValueModal({
  feature,
  revisionList,
  close,
  mutate,
  setVersion,
}: Props) {
  const { apiCall } = useAuth();
  const settings = useOrgSettings();
  const allEnvironments = useEnvironments();

  const environmentOptions = useMemo(
    () =>
      filterEnvironmentsByFeature(allEnvironments, feature).map((e) => ({
        value: e.id,
        label: e.id,
      })),
    [allEnvironments, feature],
  );

  const form = useForm<FormValues>({
    defaultValues: {
      defaultValue: getFeatureDefaultValue(feature),
      // Preserve each override's server id so re-saving unchanged overrides
      // doesn't churn ids (which would produce spurious diffs/revisions). New
      // rows get a `new_`-prefixed temp id that the server replaces on save.
      overrides: (feature.defaultValueOverrides ?? []).map((o) => ({
        id: o.id,
        value: o.value,
        environments: o.environments,
      })),
    },
  });

  const overrides = form.watch("overrides");

  const setOverrides = (next: OverrideRow[]) =>
    form.setValue("overrides", next);
  const addOverride = () =>
    setOverrides([
      ...form.getValues("overrides"),
      {
        id: `new_${nextRowId()}`,
        value: getFeatureDefaultValue(feature),
        environments: [],
      },
    ]);
  const removeOverride = (id: string) =>
    setOverrides(form.getValues("overrides").filter((o) => o.id !== id));
  const patchOverride = (id: string, patch: Partial<OverrideRow>) =>
    setOverrides(
      form
        .getValues("overrides")
        .map((o) => (o.id === id ? { ...o, ...patch } : o)),
    );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Rules/values gating: env filtering without kill-switch-specific checks.
  const gatedEnvSet: Set<string> | "all" | "none" = useMemo(() => {
    const raw = settings?.requireReviews;
    if (raw === true) return "all";
    if (!Array.isArray(raw)) return "none";
    const reviewSetting = getReviewSetting(raw, feature);
    if (!reviewSetting?.requireReviewOn) return "none";
    const envList = reviewSetting.environments ?? [];
    return envList.length === 0 ? "all" : new Set(envList);
  }, [settings?.requireReviews, feature]);

  const defaultDraft = useDefaultDraft(revisionList);

  const [mode, setMode] = useState<DraftMode>(
    defaultDraft !== null ? "existing" : "new",
  );
  const [selectedDraft, setSelectedDraft] = useState<number | null>(
    defaultDraft,
  );

  // URL version drives draft behavior: feature.version = new draft, draft version = modify existing.
  const targetVersion =
    mode === "existing" && selectedDraft !== null
      ? selectedDraft
      : feature.version;

  return (
    <ModalStandard
      trackingEventModalType=""
      header="Edit Default Value"
      cta="Save to draft"
      submit={form.handleSubmit(async (values) => {
        // Validate + normalize the base value and every override. If validation
        // rewrote anything, surface it for re-submit.
        let fixed = false;
        const normalizedDefault = validateFeatureValue(
          feature,
          values.defaultValue ?? "",
          "",
        );
        if (normalizedDefault !== values.defaultValue) fixed = true;

        const normalizedOverrides = values.overrides.map((o) => {
          const normalized = validateFeatureValue(feature, o.value ?? "", "");
          if (normalized !== o.value) fixed = true;
          return { ...o, value: normalized };
        });

        if (fixed) {
          form.setValue("defaultValue", normalizedDefault);
          form.setValue("overrides", normalizedOverrides);
          throw new Error(
            "We fixed some errors in the value. If it looks correct, submit again.",
          );
        }

        const res = await apiCall<{ version: number }>(
          `/feature/${feature.id}/${targetVersion}/defaultvalue`,
          {
            method: "POST",
            body: JSON.stringify({
              defaultValue: normalizedDefault,
              defaultValueOverrides: normalizedOverrides.map((o) => ({
                // Send the id for existing overrides so it stays stable; omit it
                // for new rows so the server assigns a permanent one.
                ...(o.id.startsWith("new_") ? {} : { id: o.id }),
                value: o.value,
                environments: o.environments,
              })),
            }),
          },
        );
        await mutate();
        setVersion(res?.version ?? targetVersion);
      })}
      close={close}
      open={true}
      size="lg"
    >
      <DraftSelectorForChanges
        feature={feature}
        revisionList={revisionList}
        mode={mode}
        setMode={setMode}
        selectedDraft={selectedDraft}
        setSelectedDraft={setSelectedDraft}
        canAutoPublish={false}
        gatedEnvSet={gatedEnvSet}
      />

      <FeatureValueField
        label="Value When Enabled"
        id="defaultValue"
        value={form.watch("defaultValue")}
        setValue={(v) => form.setValue("defaultValue", v)}
        valueType={feature.valueType}
        feature={feature}
        renderJSONInline={true}
        useCodeInput={true}
        showFullscreenButton={true}
      />

      {environmentOptions.length > 0 && (
        <Box mt="5" pt="4" style={{ borderTop: "1px solid var(--gray-a4)" }}>
          <Flex align="center" justify="between" mb="1">
            <Text as="div" weight="semibold">
              Default value overrides
            </Text>
            <Button variant="outline" size="sm" onClick={() => addOverride()}>
              <Flex align="center" gap="1">
                <PiPlus /> Add override
              </Flex>
            </Button>
          </Flex>
          <Text as="p" color="text-low" size="small" mb="3">
            Served top-to-bottom: the first override whose environments match is
            used. Environments matched by no override serve the base value
            above.
          </Text>

          {overrides.length === 0 ? (
            <Text as="div" size="small" color="text-mid">
              No overrides yet.
            </Text>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={({ active, over }) => {
                if (!over || active.id === over.id) return;
                const current = form.getValues("overrides");
                const oldIndex = current.findIndex((o) => o.id === active.id);
                const newIndex = current.findIndex((o) => o.id === over.id);
                if (oldIndex === -1 || newIndex === -1) return;
                setOverrides(arrayMove(current, oldIndex, newIndex));
              }}
            >
              <SortableContext
                items={overrides.map((o) => o.id)}
                strategy={verticalListSortingStrategy}
              >
                {overrides.map((o, i) => (
                  <OverrideRowEditor
                    key={o.id}
                    row={o}
                    index={i}
                    feature={feature}
                    environmentOptions={environmentOptions}
                    onChange={(patch) => patchOverride(o.id, patch)}
                    onRemove={() => removeOverride(o.id)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </Box>
      )}
    </ModalStandard>
  );
}

function OverrideRowEditor({
  row,
  index,
  feature,
  environmentOptions,
  onChange,
  onRemove,
}: {
  row: OverrideRow;
  index: number;
  feature: FeatureInterface;
  environmentOptions: { value: string; label: string }[];
  onChange: (patch: Partial<OverrideRow>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: row.id });

  return (
    <Box
      ref={setNodeRef}
      mb="3"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        border: "1px solid var(--gray-a4)",
        borderRadius: "var(--radius-3)",
        padding: "12px",
        background: "var(--color-panel-solid)",
      }}
    >
      <Flex align="center" justify="between" mb="2">
        <Flex align="center" gap="2">
          <IconButton
            variant="ghost"
            color="gray"
            size="1"
            aria-label="Drag to reorder"
            style={{ cursor: "grab" }}
            {...attributes}
            {...listeners}
          >
            <PiDotsSixVertical size={16} />
          </IconButton>
          <Text weight="medium">Override {index + 1}</Text>
        </Flex>
        <IconButton
          variant="ghost"
          color="red"
          size="2"
          radius="full"
          onClick={onRemove}
          aria-label={`Remove override ${index + 1}`}
        >
          <PiTrash size={16} />
        </IconButton>
      </Flex>
      <Box mb="2">
        <MultiSelectField
          label="Environments"
          value={row.environments}
          options={environmentOptions}
          onChange={(v) => onChange({ environments: v })}
          placeholder="All environments"
          helpText="Leave empty to match all environments."
        />
      </Box>
      <FeatureValueField
        id={`override-value-${row.id}`}
        value={row.value}
        setValue={(v) => onChange({ value: v })}
        valueType={feature.valueType}
        feature={feature}
        renderJSONInline={true}
        useCodeInput={true}
        showFullscreenButton={true}
      />
    </Box>
  );
}

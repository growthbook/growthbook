import { ReactNode, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import {
  validateFeatureValue,
  getReviewSetting,
  filterEnvironmentsByFeature,
  getUnreachableDefaultValueOverrideIds,
} from "shared/util";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiTrash } from "react-icons/pi";
import { RxPlus } from "react-icons/rx";
import { RiDraggable } from "react-icons/ri";
import {
  DndContext,
  DragOverlay,
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
import Badge from "@/ui/Badge";
import Tooltip from "@/components/Tooltip/Tooltip";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import FeatureValueField from "./FeatureValueField";
import FeatureCardChrome from "./FeatureCardChrome";
import { RuleCardSideColor } from "./RuleCard";

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
  // Id of the row currently being dragged; drives the ghosted source + overlay.
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeRow = overrides.find((o) => o.id === activeId) ?? null;

  // Overrides that can never serve (shadowed by earlier ones). Incomplete rows
  // (no env selected yet) are treated as drafts — neither covering nor flagged.
  const unreachableIds = useMemo(
    () => getUnreachableDefaultValueOverrideIds(overrides),
    [overrides],
  );

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

        // Every override must target at least one environment. Matching all
        // environments (empty scope) isn't allowed for now.
        if (values.overrides.some((o) => o.environments.length === 0)) {
          throw new Error(
            "Each override must target at least one environment.",
          );
        }

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

      {/* Base default value, wrapped in the same card chrome as the override
          rows (with empty grip/trash gutters) so its field lines up with them. */}
      <ModalValueCard
        sideColor="active"
        left={<Box style={{ width: 14, flexShrink: 0 }} />}
        // Reserve the delete-gutter width (IconButton size 2 = 32px) so the base
        // field lines up with the override rows — no phantom interactive control.
        right={<Box style={{ width: 32, marginRight: -4, flexShrink: 0 }} />}
      >
        <Box mb="-3">
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
        </Box>
      </ModalValueCard>

      {environmentOptions.length > 0 && (
        <Box mt="6">
          <Flex align="center" justify="between" mb="1">
            <Text as="div" weight="semibold">
              Environment overrides
            </Text>
            {/* With items present, the add button moves below the list. */}
            {overrides.length === 0 && (
              <Button
                variant="outline"
                size="sm"
                icon={<RxPlus />}
                iconPosition="left"
                onClick={() => addOverride()}
              >
                Add override
              </Button>
            )}
          </Flex>

          <Box mt="4">
            {overrides.length === 0 ? (
              <Text as="div" color="text-mid">
                <em>No overrides yet.</em>
              </Text>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={({ active }) => setActiveId(active.id as string)}
                onDragCancel={() => setActiveId(null)}
                onDragEnd={({ active, over }) => {
                  setActiveId(null);
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
                      unreachable={unreachableIds.has(o.id)}
                      onChange={(patch) => patchOverride(o.id, patch)}
                      onRemove={() => removeOverride(o.id)}
                    />
                  ))}
                </SortableContext>
                {/* Full-opacity clone that follows the cursor while the source row
                  stays ghosted in place — mirrors the feature rule list. */}
                <DragOverlay>
                  {activeRow ? (
                    <OverrideRowCard
                      row={activeRow}
                      feature={feature}
                      environmentOptions={environmentOptions}
                      valueId={`override-value-overlay-${activeRow.id}`}
                      removeLabel="Remove override"
                      unreachable={unreachableIds.has(activeRow.id)}
                      dragHandleProps={{}}
                      onChange={() => {}}
                      onRemove={() => {}}
                    />
                  ) : null}
                </DragOverlay>
              </DndContext>
            )}
            {overrides.length > 0 && (
              <Flex justify="end">
                <Button
                  variant="outline"
                  size="sm"
                  icon={<RxPlus />}
                  iconPosition="left"
                  onClick={() => addOverride()}
                >
                  Add override
                </Button>
              </Flex>
            )}
          </Box>
        </Box>
      )}
    </ModalStandard>
  );
}

// Presentational card shared by the sortable editor row and the DragOverlay
// clone so the two are pixel-identical (no size shift when a drag starts). The
// overlay passes a distinct `valueId` to avoid a duplicate DOM id on the value
// field, and no-op handlers (it's pointer-captured mid-drag).
function OverrideRowCard({
  row,
  feature,
  environmentOptions,
  valueId,
  removeLabel,
  unreachable,
  dragHandleProps,
  onChange,
  onRemove,
}: {
  row: OverrideRow;
  feature: FeatureInterface;
  environmentOptions: { value: string; label: string }[];
  valueId: string;
  removeLabel: string;
  unreachable: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  onChange: (patch: Partial<OverrideRow>) => void;
  onRemove: () => void;
}) {
  return (
    <ModalValueCard
      sideColor={unreachable ? "unreachable" : "active"}
      left={
        <Box style={{ width: 14, marginTop: 6, flexShrink: 0 }}>
          <div
            {...dragHandleProps}
            title="Drag and drop to re-order overrides"
            style={{ cursor: "grab" }}
          >
            <RiDraggable size={16} />
          </div>
        </Box>
      }
      right={
        <IconButton
          type="button"
          variant="ghost"
          color="red"
          size="2"
          radius="full"
          onClick={onRemove}
          aria-label={removeLabel}
          style={{ marginTop: 4, marginRight: -4, flexShrink: 0 }}
        >
          <PiTrash size={16} />
        </IconButton>
      }
    >
      <Box mb="2">
        <Flex align="center" gap="2">
          <Box flexGrow="1" style={{ minWidth: 0 }}>
            <MultiSelectField
              value={row.environments}
              options={environmentOptions}
              onChange={(v) => onChange({ environments: v })}
              placeholder="Select environments"
            />
          </Box>
          {unreachable && (
            <Tooltip body="Every environment this override targets is already served by an earlier override, so this one is never used. Reorder or change its environments to make it reachable.">
              <Badge
                label="Unreachable"
                color="orange"
                variant="soft"
                radius="full"
                size="sm"
              />
            </Tooltip>
          )}
        </Flex>
      </Box>
      {/* The value field carries its own trailing margin; pull it back in
          to tighten the card's bottom padding. */}
      <Box mt="3" mb="-3">
        <FeatureValueField
          label="Value When Enabled"
          id={valueId}
          value={row.value}
          setValue={(v) => onChange({ value: v })}
          valueType={feature.valueType}
          feature={feature}
          renderJSONInline={true}
          useCodeInput={true}
          showFullscreenButton={true}
        />
      </Box>
    </ModalValueCard>
  );
}

// Green/orange-edged card chrome shared by the base value and each override row
// (not Radix Card, so nothing clips the env select's menu). `left`/`right` are
// the grip and delete gutters; the base value passes empty/hidden placeholders
// so its field lines up with the override rows.
function ModalValueCard({
  sideColor,
  left,
  right,
  children,
}: {
  sideColor: RuleCardSideColor;
  left: ReactNode;
  right: ReactNode;
  children: ReactNode;
}) {
  return (
    <FeatureCardChrome sideColor={sideColor}>
      <Flex align="start" justify="between" gap="4" p="3">
        {left}
        <Box flexGrow="1" style={{ maxWidth: "100%", minWidth: 0 }}>
          {children}
        </Box>
        {right}
      </Flex>
    </FeatureCardChrome>
  );
}

function OverrideRowEditor({
  row,
  index,
  feature,
  environmentOptions,
  unreachable,
  onChange,
  onRemove,
}: {
  row: OverrideRow;
  index: number;
  feature: FeatureInterface;
  environmentOptions: { value: string; label: string }[];
  unreachable: boolean;
  onChange: (patch: Partial<OverrideRow>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, active } =
    useSortable({ id: row.id });

  return (
    <Box
      ref={setNodeRef}
      mb="4"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        // Ghost the source in place while its full-opacity clone is dragged
        // (the DragOverlay renders the clone) — same as the rule list.
        opacity: active?.id === row.id ? 0.3 : 1,
      }}
    >
      <OverrideRowCard
        row={row}
        feature={feature}
        environmentOptions={environmentOptions}
        valueId={`override-value-${row.id}`}
        removeLabel={`Remove override ${index + 1}`}
        unreachable={unreachable}
        dragHandleProps={{ ...attributes, ...listeners }}
        onChange={onChange}
        onRemove={onRemove}
      />
    </Box>
  );
}

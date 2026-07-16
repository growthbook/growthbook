import { ReactNode, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { FeatureInterface } from "shared/types/feature";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import {
  validateFeatureValue,
  getReviewSetting,
  filterEnvironmentsByFeature,
  getUnreachableDefaultValueOverrideIndexes,
} from "shared/util";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiPlusBold, PiTrash } from "react-icons/pi";
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

// `key` is a client-only identity for drag/drop and React keys; it is never
// persisted (overrides have no server id).
type OverrideRow = {
  key: string;
  value: string;
  environments: string[];
};

type FormValues = {
  defaultValue: string;
  overrides: OverrideRow[];
};

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
      // Seed each row's client key from its load-time index.
      overrides: (feature.defaultValueOverrides ?? []).map((o, i) => ({
        key: String(i),
        value: o.value,
        environments: o.environments,
      })),
    },
  });

  const overrides = form.watch("overrides");
  const nextKey = useRef(overrides.length);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const activeRow = overrides.find((o) => o.key === activeKey) ?? null;

  // Positions of overrides shadowed by an earlier one (never served).
  const unreachableIndexes = useMemo(
    () => getUnreachableDefaultValueOverrideIndexes(overrides),
    [overrides],
  );

  const setOverrides = (next: OverrideRow[]) =>
    form.setValue("overrides", next);
  const addOverride = () =>
    setOverrides([
      ...form.getValues("overrides"),
      {
        key: String(nextKey.current++),
        value: form.getValues("defaultValue"),
        environments: [],
      },
    ]);
  const removeOverride = (key: string) =>
    setOverrides(form.getValues("overrides").filter((o) => o.key !== key));
  const patchOverride = (key: string, patch: Partial<OverrideRow>) =>
    setOverrides(
      form
        .getValues("overrides")
        .map((o) => (o.key === key ? { ...o, ...patch } : o)),
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

      {/* Base value in the override card chrome, with empty grip/trash gutters
          (14px / 32px) so its field lines up with the override rows. */}
      <ModalValueCard
        sideColor="active"
        left={<Box style={{ width: 14, flexShrink: 0 }} />}
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
                icon={<PiPlusBold />}
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
                onDragStart={({ active }) => setActiveKey(active.id as string)}
                onDragCancel={() => setActiveKey(null)}
                onDragEnd={({ active, over }) => {
                  setActiveKey(null);
                  if (!over || active.id === over.id) return;
                  const current = form.getValues("overrides");
                  const oldIndex = current.findIndex(
                    (o) => o.key === active.id,
                  );
                  const newIndex = current.findIndex((o) => o.key === over.id);
                  if (oldIndex === -1 || newIndex === -1) return;
                  setOverrides(arrayMove(current, oldIndex, newIndex));
                }}
              >
                <SortableContext
                  items={overrides.map((o) => o.key)}
                  strategy={verticalListSortingStrategy}
                >
                  {overrides.map((o, i) => (
                    <OverrideRowEditor
                      key={o.key}
                      row={o}
                      index={i}
                      feature={feature}
                      environmentOptions={environmentOptions}
                      unreachable={unreachableIndexes.has(i)}
                      onChange={(patch) => patchOverride(o.key, patch)}
                      onRemove={() => removeOverride(o.key)}
                    />
                  ))}
                </SortableContext>
                <DragOverlay>
                  {activeRow ? (
                    <OverrideRowCard
                      row={activeRow}
                      feature={feature}
                      environmentOptions={environmentOptions}
                      valueId={`override-value-overlay-${activeRow.key}`}
                      removeLabel="Remove override"
                      unreachable={unreachableIndexes.has(
                        overrides.findIndex((o) => o.key === activeRow.key),
                      )}
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
                  icon={<PiPlusBold />}
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

// Shared by the sortable editor row and the DragOverlay clone so the two are
// pixel-identical. The overlay passes a distinct `valueId` to avoid a duplicate
// DOM id.
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

// Card chrome for the base value and each override row. `left`/`right` are the
// grip and delete gutters (the base value passes empty spacers).
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
    useSortable({ id: row.key });

  return (
    <Box
      ref={setNodeRef}
      mb="4"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        // Ghost the source while the DragOverlay clone is dragged.
        opacity: active?.id === row.key ? 0.3 : 1,
      }}
    >
      <OverrideRowCard
        row={row}
        feature={feature}
        environmentOptions={environmentOptions}
        valueId={`override-value-${row.key}`}
        removeLabel={`Remove override ${index + 1}`}
        unreachable={unreachable}
        dragHandleProps={{ ...attributes, ...listeners }}
        onChange={onChange}
        onRemove={onRemove}
      />
    </Box>
  );
}

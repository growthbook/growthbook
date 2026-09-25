import { useMemo, useState } from "react";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import { FeatureValueType } from "shared/types/feature";
import {
  castFeatureValue,
  expandSparseToFull,
  getConfigSubtree,
  getFeatureBaseConfigKey,
  isManagedByExperiment,
  parsePlainJSONObject,
  stripDefaultsForSparse,
  validateFeatureValue,
} from "shared/util";
import { Box, Flex, Grid } from "@radix-ui/themes";
import ForceSummary from "@/components/Features/ForceSummary";
import FeatureValueField from "@/components/Features/FeatureValueField";
import ValueTypeField from "@/components/Features/FeatureModal/ValueTypeField";
import SparsePatchToggle from "@/components/Features/SparsePatchToggle";
import UnpublishedDot from "@/components/Experiment/UnpublishedDot";
import { getVariationValueChanges } from "@/components/Experiment/LinkedChanges/linkedFeatureDiff";
import {
  VARIATION_GRID_COLUMNS,
  variationGridMaxWidth,
} from "@/components/Experiment/VariationsTable";
import { revisionLabelText } from "@/components/Reviews/RevisionLabel";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import VariationLabel from "@/ui/VariationLabel";
import { useRegisterExperimentEdit } from "./ExperimentEdits";

const VALUE_TYPE_ORDER: FeatureValueType[] = [
  "string",
  "json",
  "number",
  "boolean",
];

type Staged = {
  values: Record<string, string>;
  valueType?: FeatureValueType;
  sparse?: boolean;
};

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures: LinkedFeatureInfo[];
  canEdit: boolean;
  /** Show what is live rather than the draft, read-only. */
  showLive?: boolean;
}

/** One row per linked Feature Flag, a cell per variation, under the variation cards. */
export default function FlagValueRows({
  experiment,
  linkedFeatures,
  canEdit,
  showLive = false,
}: Props) {
  const variations = getLatestPhaseVariations(experiment);
  const cols = Math.min(variations.length, 3);

  if (!linkedFeatures.length || !variations.length) return null;

  return (
    <Flex
      direction="column"
      gap="4"
      mt="4"
      mx="auto"
      width="100%"
      style={{ maxWidth: variationGridMaxWidth(cols) }}
    >
      {linkedFeatures.map((info) => (
        <FlagValueRow
          key={info.feature.id}
          experiment={experiment}
          info={info}
          canEdit={canEdit}
          showLive={showLive}
        />
      ))}
    </Flex>
  );
}

function FlagValueRow({
  experiment,
  info,
  canEdit,
  showLive,
}: {
  experiment: ExperimentInterfaceStringDates;
  info: LinkedFeatureInfo;
  canEdit: boolean;
  showLive: boolean;
}) {
  const permissionsUtil = usePermissionsUtil();
  const { configs } = useDefinitions();
  const variations = getLatestPhaseVariations(experiment);
  const { feature, pendingDraft } = info;

  const fromDraft = !!pendingDraft && !showLive;
  const managed = isManagedByExperiment(feature, experiment.id);
  const values = fromDraft
    ? pendingDraft.values
    : (info.liveValues ?? info.values);
  const storedSparse = fromDraft
    ? pendingDraft.sparse
    : (info.liveSparse ?? info.sparse ?? false);
  const storedType = fromDraft ? pendingDraft.valueType : feature.valueType;
  const storedDefault = fromDraft
    ? pendingDraft.defaultValue
    : feature.defaultValue;

  const [staged, setStaged] = useState<Staged | null>(null);
  const storedValue = (variationId: string) =>
    values.find((v) => v.variationId === variationId)?.value;
  const valueFor = (variationId: string) =>
    staged?.values[variationId] ?? storedValue(variationId);
  const valueType = staged?.valueType ?? storedType;
  const sparse = staged?.sparse ?? storedSparse;

  // A managed flag's default is its control value, so that is what the other
  // variations patch onto.
  const controlId = variations[0]?.id;
  const sparseBase =
    (managed && controlId ? valueFor(controlId) : undefined) ??
    storedDefault ??
    "";
  const configKey = getFeatureBaseConfigKey(feature);
  const configBackingOptionKeys = useMemo(
    () => (configKey ? getConfigSubtree(configKey, configs) : undefined),
    [configKey, configs],
  );
  // Only a flag that is JSON already: a re-type in the same edit has no base yet.
  const sparseEligible =
    !configKey &&
    valueType === "json" &&
    storedType === "json" &&
    parsePlainJSONObject(sparseBase) !== null;

  // Against the type and default the values will land under.
  const displayFeature = useMemo(
    () => ({ ...feature, valueType, defaultValue: sparseBase }),
    [feature, valueType, sparseBase],
  );
  const draftIds = useMemo(
    () =>
      new Set(
        fromDraft
          ? getVariationValueChanges(
              info,
              variations.map((v) => v.id),
            )
              .filter((c) => c.unpublished)
              .map((c) => c.variationId)
          : [],
      ),
    [info, variations, fromDraft],
  );

  const lockedBySchedule = !!pendingDraft?.lockedBySchedule;
  const editable =
    canEdit &&
    !showLive &&
    !lockedBySchedule &&
    permissionsUtil.canEditFeatureDrafts(feature) &&
    (info.state === "live" || info.state === "draft");

  const stage = (patch: Partial<Staged>) =>
    setStaged((prev) => ({
      values: { ...prev?.values, ...patch.values },
      valueType: patch.valueType ?? prev?.valueType,
      sparse: patch.sparse ?? prev?.sparse,
    }));

  // Re-express what is already there rather than clearing it.
  const changeType = (next: FeatureValueType) => {
    if (next === valueType) return;
    stage({
      valueType: next,
      values: Object.fromEntries(
        variations.map((v, i) => [
          v.id,
          castFeatureValue({
            value: valueFor(v.id) ?? "",
            from: valueType,
            to: next,
            index: i,
          }),
        ]),
      ),
    });
  };

  // Rewrites every value, like the rule editors; control is the base itself.
  const toggleSparse = (checked: boolean) =>
    stage({
      sparse: checked,
      values: Object.fromEntries(
        variations
          .filter((v) => !(managed && v.id === controlId))
          .map((v) => {
            const current = valueFor(v.id) ?? "";
            return [
              v.id,
              checked
                ? stripDefaultsForSparse(current, sparseBase)
                : expandSparseToFull(current, sparseBase),
            ];
          }),
      ),
    });

  const dirty =
    !!staged &&
    (valueType !== storedType ||
      sparse !== storedSparse ||
      Object.entries(staged.values).some(
        ([id, value]) => value !== storedValue(id),
      ));

  // Like the values modal: repair loose values in place, then ask for a
  // second save, so nothing lands that the user hasn't seen.
  const checkedValues = () => {
    const checked = variations.map((v) => ({
      variationId: v.id,
      value: validateFeatureValue(
        { valueType, jsonSchema: feature.jsonSchema },
        valueFor(v.id) ?? "",
        `${feature.id}, ${v.name || `Variation ${v.index}`}`,
      ),
    }));
    const repaired = checked.filter((c) => c.value !== valueFor(c.variationId));
    if (repaired.length) {
      stage({
        values: Object.fromEntries(
          repaired.map((c) => [c.variationId, c.value]),
        ),
      });
      throw new Error(
        `We fixed some errors in the ${feature.id} values. If they look correct, save again.`,
      );
    }
    return checked;
  };

  useRegisterExperimentEdit(`flag:${feature.id}`, dirty, {
    changes: () => ({
      flagValues: [
        {
          featureId: feature.id,
          variations: checkedValues(),
          ...(valueType !== storedType && { valueType }),
          ...(sparse !== storedSparse && { sparse }),
          // Writes into the draft the values came from; off live, starts one.
          revision: pendingDraft
            ? {
                version: pendingDraft.version,
                dateUpdated: pendingDraft.dateUpdated,
              }
            : { version: feature.version, dateUpdated: null },
        },
      ],
    }),
    onSaved: () => setStaged(null),
    discard: () => setStaged(null),
  });

  return (
    <Box>
      <Flex align="center" gap="2" mb="2">
        <Link href={`/features/${feature.id}`} weight="medium">
          {feature.id}
        </Link>
        <Text size="sm" color="text-low">
          {fromDraft
            ? revisionLabelText(pendingDraft.version, pendingDraft.title)
            : "Live"}
        </Text>
        {editable &&
        (experiment.status !== "draft" ||
          experiment.nextScheduledStatusUpdate?.type === "start") ? (
          <HelperText status="info" size="sm">
            Saves to a draft. Publishing it changes what this experiment serves.
          </HelperText>
        ) : null}
        {lockedBySchedule && !showLive ? (
          <HelperText status="info" size="sm">
            Locked until its scheduled publish
          </HelperText>
        ) : null}
        <Flex align="center" gap="3" ml="auto">
          {editable && sparseEligible ? (
            <SparsePatchToggle checked={sparse} onChange={toggleSparse} />
          ) : null}
          {editable && managed ? (
            <Box width="160px">
              <ValueTypeField
                size="sm"
                value={valueType}
                order={VALUE_TYPE_ORDER}
                disabledOptions={
                  variations.length > 2
                    ? { boolean: "needs exactly two variations" }
                    : undefined
                }
                onChange={(v) => {
                  if (v !== "config") changeType(v);
                }}
              />
            </Box>
          ) : null}
        </Flex>
      </Flex>
      <Grid columns={VARIATION_GRID_COLUMNS} gap="4">
        {variations.map((v) => {
          const value = valueFor(v.id);
          return (
            <Box key={v.id} className="appbox mb-0" p="3" minWidth="0">
              <Flex align="center" gap="2" mb="2">
                <Box minWidth="0" flexGrow="1">
                  <VariationLabel number={v.index} name={v.name} size="sm" />
                </Box>
                {draftIds.has(v.id) && staged?.values[v.id] === undefined ? (
                  <UnpublishedDot tooltip="Unpublished draft value" />
                ) : null}
              </Flex>
              {editable ? (
                <FeatureValueField
                  id={`flag-${feature.id}-${v.id}`}
                  value={value ?? ""}
                  setValue={(next) => stage({ values: { [v.id]: next } })}
                  valueType={valueType}
                  feature={displayFeature}
                  renderJSONInline
                  useCodeInput
                  showFullscreenButton
                  sparse={sparse}
                  allowConfigBacking={!!configKey}
                  configBackingOptionKeys={configBackingOptionKeys}
                  configBackingShowPatch={!!configKey}
                  lockConfigBacking={!!configKey}
                />
              ) : value === undefined ? (
                <HelperText status="warning">No value set</HelperText>
              ) : (
                <ForceSummary
                  label={null}
                  value={value}
                  feature={displayFeature}
                  sparse={sparse}
                  fontSize="0.75rem"
                  lineHeight={1.35}
                />
              )}
            </Box>
          );
        })}
      </Grid>
    </Box>
  );
}

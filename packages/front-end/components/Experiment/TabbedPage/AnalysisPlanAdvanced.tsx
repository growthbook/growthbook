import { ReactNode, useEffect, useMemo, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import {
  getExposureQueryIdentifierTypes,
  resolveAnalysisIdentifierType,
} from "shared/util";
import { getValidDate } from "shared/dates";
import { getScopedSettings } from "shared/settings";
import {
  DEFAULT_POST_STRATIFICATION_ENABLED,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  MAX_PRECOMPUTED_UNIT_DIMENSIONS,
} from "shared/constants";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentAnalysisSettingsDraft } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import {
  datasourceHasWritableEphemeralPipeline,
  getIsExperimentIncludedInIncrementalRefresh,
} from "@/services/experiments";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import SelectField from "@/components/Forms/SelectField";
import Field from "@/components/Forms/Field";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import MetricSelector from "@/components/Experiment/MetricSelector";
import MetricAnalysisWindowSelector from "@/components/Experiment/MetricAnalysisWindowSelector";
import CustomMetricSlicesSelector from "@/components/Experiment/CustomMetricSlicesSelector";
import MultiSelectField from "@/ui/MultiSelectField";
import Collapse, { CollapseTrigger } from "@/ui/Collapse";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Tooltip from "@/ui/Tooltip";

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Frame mb="3" px="5" py="4">
      <Heading as="h5" size="sm" color="text-high" mb="4">
        {title}
      </Heading>
      <Flex direction="column" gap="4">
        {children}
      </Flex>
    </Frame>
  );
}

function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Text as="div" size="sm" weight="medium" color="text-high" mb="2">
        {label}
      </Text>
      {children}
    </Box>
  );
}

/** The analysis plan's less common settings, staged with the rest of the plan. */
export default function AnalysisPlanAdvanced({
  open,
  setOpen,
  experiment,
  savedStatsEngine,
  datasourceId,
  exposureQueryId,
  metrics,
  stage,
  manageOverrides,
  canEdit,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The experiment with the plan's staged settings applied. */
  experiment: ExperimentInterfaceStringDates;
  // An engine once saved can't be cleared back to the default here.
  savedStatsEngine?: ExperimentInterfaceStringDates["statsEngine"];
  datasourceId: string;
  exposureQueryId: string;
  metrics: {
    goalMetrics: string[];
    secondaryMetrics: string[];
    guardrailMetrics: string[];
  };
  stage: (changes: ExperimentAnalysisSettingsDraft) => void;
  /** Opens the overrides editor on every metric; omitted where it can't open. */
  manageOverrides?: () => void;
  canEdit: boolean;
}) {
  const { getDatasourceById, getProjectById, segments, dimensions } =
    useDefinitions();
  const { organization, hasCommercialFeature } = useUser();
  const orgSettings = useOrgSettings();

  const { settings: defaults } = getScopedSettings({
    organization,
    project: getProjectById(experiment.project || "") ?? undefined,
  });
  const statsEngine = experiment.statsEngine || defaults.statsEngine.value;

  const datasource = getDatasourceById(datasourceId);
  const properties = datasource?.properties;
  const exposureQuery = datasource?.settings?.queries?.exposure?.find(
    (q) => q.id === exposureQueryId,
  );
  const identifierType = exposureQuery
    ? resolveAnalysisIdentifierType(
        exposureQuery,
        experiment.exposureQueryIdentifierType,
      )
    : undefined;
  const incrementalRefresh = getIsExperimentIncludedInIncrementalRefresh(
    datasource ?? undefined,
    experiment.id,
    experiment.type,
  );

  const hasCuped = hasCommercialFeature("regression-adjustment");
  const hasPostStratification = hasCommercialFeature("post-stratification");
  const hasSequential = hasCommercialFeature("sequential-testing");
  const cupedDefault = defaults.regressionAdjustmentEnabled.value;
  const varianceReductionChanged =
    !!experiment.regressionAdjustmentEnabled !== cupedDefault ||
    (experiment.postStratificationEnabled ?? null) !== null;
  const sequentialEnabled = !!experiment.sequentialTestingEnabled;
  const tuningParameter =
    experiment.sequentialTestingTuningParameter ??
    orgSettings.sequentialTestingTuningParameter ??
    DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER;
  // Typed as text, so "0." can be on its way to a valid value.
  const [tuningText, setTuningText] = useState(String(tuningParameter));
  useEffect(() => {
    setTuningText((text) =>
      parseFloat(text) === tuningParameter ? text : String(tuningParameter),
    );
  }, [tuningParameter]);

  const unitDimensionOptions = useMemo(
    () =>
      datasourceHasWritableEphemeralPipeline(
        datasource,
        hasCommercialFeature("pipeline-mode"),
      )
        ? dimensions
            .filter(
              (d) =>
                d.datasource === datasourceId &&
                (!identifierType || d.userIdType === identifierType),
            )
            .map((d) => ({ label: d.name, value: d.id }))
        : [],
    [
      datasource,
      datasourceId,
      dimensions,
      identifierType,
      hasCommercialFeature,
    ],
  );
  const unitDimensionIds = experiment.precomputedUnitDimensionIds || [];
  const datasourceSegments = segments.filter(
    (s) => s.datasource === datasourceId,
  );
  const hasMetrics =
    metrics.goalMetrics.length +
      metrics.secondaryMetrics.length +
      metrics.guardrailMetrics.length >
    0;
  const disabled = !canEdit;

  return (
    <Box id="analysis-plan-advanced" mt="3">
      <Separator size="4" mb="4" />
      <CollapseTrigger open={open} onOpenChange={setOpen} caret="start">
        <Text weight="medium" color="text-high">
          Advanced
        </Text>
      </CollapseTrigger>
      <Collapse open={open}>
        <Box pt="3">
          <Card title="Statistics">
            <Setting label="Stats Engine">
              <Box maxWidth="300px">
                <StatsEngineSelect
                  label={null}
                  labelClassName=""
                  containerClassName="mb-0"
                  className=""
                  value={experiment.statsEngine}
                  onChange={(value) =>
                    stage({ statsEngine: value || undefined })
                  }
                  parentSettings={defaults}
                  allowUndefined={!savedStatsEngine}
                  disabled={disabled}
                />
              </Box>
            </Setting>
            <Setting label="Variance Reduction">
              <Flex direction="column" gap="2">
                <Flex align="center" gap="4">
                  <Checkbox
                    label={
                      <PremiumTooltip commercialFeature="regression-adjustment">
                        CUPED
                      </PremiumTooltip>
                    }
                    weight="regular"
                    value={hasCuped && !!experiment.regressionAdjustmentEnabled}
                    setValue={(value) =>
                      stage({ regressionAdjustmentEnabled: value })
                    }
                    disabled={disabled || !hasCuped}
                  />
                  {varianceReductionChanged && !disabled ? (
                    <Link
                      onClick={(e) => {
                        e.preventDefault();
                        stage({
                          regressionAdjustmentEnabled: cupedDefault,
                          postStratificationEnabled: null,
                        });
                      }}
                    >
                      Reset to Defaults
                    </Link>
                  ) : null}
                </Flex>
                {!orgSettings.disablePrecomputedDimensions ? (
                  <Checkbox
                    label={
                      <PremiumTooltip commercialFeature="post-stratification">
                        Post-stratification
                      </PremiumTooltip>
                    }
                    weight="regular"
                    value={
                      hasPostStratification &&
                      (experiment.postStratificationEnabled ??
                        defaults.postStratificationEnabled.value ??
                        DEFAULT_POST_STRATIFICATION_ENABLED)
                    }
                    setValue={(value) =>
                      stage({ postStratificationEnabled: value })
                    }
                    disabled={disabled || !hasPostStratification}
                  />
                ) : null}
              </Flex>
            </Setting>
            {statsEngine === "frequentist" ? (
              <Setting label="Corrections">
                <Flex direction="column" gap="2">
                  <Checkbox
                    label={
                      <PremiumTooltip commercialFeature="sequential-testing">
                        Sequential Testing
                      </PremiumTooltip>
                    }
                    weight="regular"
                    value={hasSequential && sequentialEnabled}
                    setValue={(value) =>
                      stage({
                        sequentialTestingEnabled: value,
                        sequentialTestingTuningParameter: tuningParameter,
                      })
                    }
                    disabled={disabled || !hasSequential}
                  />
                  {sequentialEnabled ? (
                    <Box width="200px">
                      <Field
                        label="Tuning parameter"
                        type="number"
                        min="0"
                        containerClassName="mb-0"
                        value={tuningText}
                        onChange={(e) => {
                          setTuningText(e.target.value);
                          const value = parseFloat(e.target.value);
                          if (value > 0) {
                            stage({ sequentialTestingTuningParameter: value });
                          }
                        }}
                        disabled={disabled || !hasSequential}
                      />
                    </Box>
                  ) : null}
                </Flex>
              </Setting>
            ) : null}
          </Card>

          {datasource ? (
            <Card title="Exposures">
              <Setting label="Activation Metric">
                <Tooltip
                  content="Activation Metrics are not yet supported with Incremental Refresh."
                  enabled={incrementalRefresh}
                >
                  <Box>
                    <MetricSelector
                      datasource={datasourceId}
                      exposureQueryId={exposureQueryId}
                      exposureQueryIdentifierType={identifierType}
                      project={experiment.project}
                      includeFacts
                      initialOption="None"
                      onlyBinomial
                      filterFactFunnelMetrics
                      value={experiment.activationMetric || ""}
                      onChange={(value) =>
                        stage({ activationMetric: value || "" })
                      }
                      helpText="Users must convert on this metric before being included."
                      disabled={disabled || incrementalRefresh}
                    />
                  </Box>
                </Tooltip>
              </Setting>
              {properties?.experimentSegments &&
              datasourceSegments.length > 0 ? (
                <Setting label="Segment">
                  <SelectField
                    value={experiment.segment || ""}
                    onChange={(value) => stage({ segment: value || "" })}
                    initialOption="None (All Users)"
                    options={datasourceSegments.map((s) => ({
                      label: s.name,
                      value: s.id,
                    }))}
                    helpText="Only users in this segment will be included."
                    disabled={disabled}
                  />
                </Setting>
              ) : null}
              {properties?.queryLanguage === "sql" ? (
                <Setting label="Custom SQL Filter">
                  <Field
                    textarea
                    value={experiment.queryFilter || ""}
                    onChange={(e) => stage({ queryFilter: e.target.value })}
                    placeholder="e.g. user_id NOT IN ('123', '456')"
                    containerClassName="mb-0"
                    disabled={disabled}
                  />
                  <HelperText status="info" size="sm" mt="1">
                    A WHERE clause added to the experiment query. Columns:{" "}
                    {["timestamp", "variation_id"]
                      .concat(
                        exposureQuery
                          ? getExposureQueryIdentifierTypes(exposureQuery)
                          : [],
                      )
                      .concat(exposureQuery?.dimensions || [])
                      .map((column, i) => (
                        <span key={column}>
                          {i > 0 ? ", " : null}
                          <code>{column}</code>
                        </span>
                      ))}
                    .
                  </HelperText>
                </Setting>
              ) : null}
            </Card>
          ) : null}

          {datasource ? (
            <Card title="Metrics">
              {properties?.separateExperimentResultQueries ? (
                <>
                  <Setting label="Conversion Windows">
                    <Tooltip
                      content="In-progress conversions can't be excluded with Incremental Refresh while in beta."
                      enabled={incrementalRefresh}
                    >
                      <Box>
                        <SelectField
                          value={
                            experiment.skipPartialData ? "strict" : "loose"
                          }
                          onChange={(value) =>
                            stage({ skipPartialData: value === "strict" })
                          }
                          options={[
                            {
                              label: "Include In-Progress Conversions",
                              value: "loose",
                            },
                            {
                              label: "Exclude In-Progress Conversions",
                              value: "strict",
                            },
                          ]}
                          isOptionDisabled={(option) =>
                            incrementalRefresh &&
                            "value" in option &&
                            option.value === "strict"
                          }
                          helpText="How to treat users not enrolled long enough to complete a conversion window."
                          disabled={disabled}
                        />
                      </Box>
                    </Tooltip>
                  </Setting>
                  <MetricAnalysisWindowSelector
                    attributionModel={
                      experiment.attributionModel ||
                      orgSettings.attributionModel ||
                      "firstExposure"
                    }
                    lookbackOverride={experiment.lookbackOverride}
                    onAttributionModelChange={(value) =>
                      stage({ attributionModel: value })
                    }
                    onLookbackOverrideChange={(value) =>
                      stage({ lookbackOverride: value })
                    }
                    phaseEndDate={
                      experiment.status === "stopped"
                        ? getValidDate(
                            experiment.phases.at(-1)?.dateEnded ?? "",
                          )
                        : new Date()
                    }
                    disabled={disabled || incrementalRefresh}
                  />
                </>
              ) : null}
              {unitDimensionOptions.length > 0 ? (
                <Setting label="Always-computed Unit Dimensions">
                  <MultiSelectField
                    value={unitDimensionIds}
                    options={unitDimensionOptions}
                    isOptionDisabled={(option) =>
                      "value" in option &&
                      unitDimensionIds.length >=
                        MAX_PRECOMPUTED_UNIT_DIMENSIONS &&
                      !unitDimensionIds.includes(option.value)
                    }
                    onChange={(value) =>
                      stage({
                        precomputedUnitDimensionIds: value.slice(
                          0,
                          MAX_PRECOMPUTED_UNIT_DIMENSIONS,
                        ),
                      })
                    }
                    helpText={`Computed on every refresh, like precomputed dimensions. Up to ${MAX_PRECOMPUTED_UNIT_DIMENSIONS}.`}
                    disabled={disabled}
                  />
                </Setting>
              ) : null}
              <CustomMetricSlicesSelector
                goalMetrics={metrics.goalMetrics}
                secondaryMetrics={metrics.secondaryMetrics}
                guardrailMetrics={metrics.guardrailMetrics}
                customMetricSlices={experiment.customMetricSlices || []}
                setCustomMetricSlices={(slices) =>
                  stage({ customMetricSlices: slices })
                }
              />
              {hasMetrics && manageOverrides ? (
                <Setting label="Metric Overrides">
                  <Flex align="center" justify="between" gap="3">
                    <Text color="text-mid" size="sm">
                      Override metric behaviors within this experiment.
                    </Text>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={manageOverrides}
                    >
                      Manage overrides
                    </Button>
                  </Flex>
                </Setting>
              ) : null}
            </Card>
          ) : null}
        </Box>
      </Collapse>
    </Box>
  );
}

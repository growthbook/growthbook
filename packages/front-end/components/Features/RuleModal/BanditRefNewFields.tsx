import { useFormContext } from "react-hook-form";
import { Fragment, useEffect, useMemo, useState } from "react";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import {
  FeatureInterface,
  FeaturePrerequisite,
  SavedGroupTargeting,
} from "shared/types/feature";
import Collapsible from "react-collapsible";
import { PiCaretRightFill } from "react-icons/pi";
import { Box, Separator } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import useOrgSettings from "@/hooks/useOrgSettings";
import SelectField from "@/components/Forms/SelectField";
import FallbackAttributeSelector from "@/components/Features/FallbackAttributeSelector";
import HashVersionSelector, {
  allConnectionsSupportBucketingV2,
} from "@/components/Experiment/HashVersionSelector";
import {
  getFeatureDefaultValue,
  useAttributeSchema,
} from "@/services/features";
import useSDKConnections from "@/hooks/useSDKConnections";
import TargetingFieldsGroup from "@/components/Features/TargetingFieldsGroup";
import { type RuleCyclicResult } from "@/components/Features/PrerequisiteInput";
import NamespaceSelector from "@/components/Features/NamespaceSelector";
import FeatureVariationsInput from "@/components/Features/FeatureVariationsInput";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useContextualBanditQueries } from "@/hooks/useContextualBanditQueries";
import AddEditContextualBanditQueryModal from "@/components/ContextualBandit/AddEditContextualBanditQueryModal";
import ExperimentMetricsSelector from "@/components/Experiment/ExperimentMetricsSelector";
import BanditDecisionMetricSettings from "@/components/Experiment/BanditDecisionMetricSettings";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import CustomMetricSlicesSelector from "@/components/Experiment/CustomMetricSlicesSelector";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { GBCuped } from "@/components/Icons";
import { useUser } from "@/services/UserContext";
import { SortableVariation } from "@/components/Features/SortableFeatureVariationRow";
import Tooltip from "@/components/Tooltip/Tooltip";
import {
  AttributeOptionWithTooltip,
  type AttributeOptionForTooltip,
} from "@/components/Features/AttributeOptionTooltip";
import Switch from "@/ui/Switch";
import BanditSettings from "@/components/GeneralSettings/BanditSettings";
import RuleEnvironmentScopeField, {
  type EnvScopeProps,
} from "@/components/Features/RuleModal/EnvironmentScopeField";
import Checkbox from "@/ui/Checkbox";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";

export default function BanditRefNewFields({
  step,
  source,
  feature,
  project,
  environments,
  prerequisiteValue,
  setPrerequisiteValue,
  setPrerequisiteTargetingSdkIssues,
  isCyclic,
  cyclicFeatureId,
  savedGroupValue,
  setSavedGroupValue,
  defaultConditionValue,
  setConditionValue,
  conditionKey,
  namespaceFormPrefix = "",
  // variation input fields
  coverage,
  setCoverage,
  setWeight,
  variations,
  setVariations,
  disableBanditConversionWindow,
  setDisableBanditConversionWindow,
  contextualBandit,
  setContextualBandit,
  hideContextualBanditToggle,
  envScope,
  onRuleCyclicChange,
}: {
  step: number;
  source: "rule" | "experiment";
  feature?: FeatureInterface;
  project?: string;
  environments: string[];
  prerequisiteValue: FeaturePrerequisite[];
  setPrerequisiteValue: (prerequisites: FeaturePrerequisite[]) => void;
  setPrerequisiteTargetingSdkIssues: (b: boolean) => void;
  isCyclic?: boolean;
  cyclicFeatureId?: string | null;
  savedGroupValue: SavedGroupTargeting[];
  setSavedGroupValue: (savedGroups: SavedGroupTargeting[]) => void;
  defaultConditionValue: string;
  setConditionValue: (s: string) => void;
  conditionKey: number;
  namespaceFormPrefix?: string;
  coverage: number;
  setCoverage: (c: number) => void;
  setWeight: (i: number, w: number) => void;
  variations: SortableVariation[];
  setVariations: (v: SortableVariation[]) => void;
  disableBanditConversionWindow: boolean;
  setDisableBanditConversionWindow: (v: boolean) => void;
  contextualBandit: boolean;
  setContextualBandit: (v: boolean) => void;
  hideContextualBanditToggle?: boolean;
  envScope?: EnvScopeProps;
  onRuleCyclicChange?: (result: RuleCyclicResult) => void;
}) {
  const form = useFormContext();

  const { hasCommercialFeature } = useUser();
  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment",
  );
  const hasContextualBanditFeature = hasCommercialFeature("contextual-bandits");

  const { datasources, getDatasourceById, getExperimentMetricById } =
    useDefinitions();

  const datasource = form.watch("datasource")
    ? getDatasourceById(form.watch("datasource") ?? "")
    : null;

  const exposureQueries = datasource?.settings?.queries?.exposure;
  const exposureQueryId = form.watch("exposureQueryId");

  const { contextualBanditQueries: cbQueries, mutate: mutateCbQueries } =
    useContextualBanditQueries(
      contextualBandit ? (datasource?.id ?? undefined) : undefined,
    );
  const [cbQueryModalOpen, setCbQueryModalOpen] = useState(false);

  type PickerQuery = {
    id: string;
    name: string;
    userIdType?: string;
    targetingAttributeColumns?: string[];
  };

  const assignmentQueriesForPicker: PickerQuery[] = useMemo(
    () =>
      contextualBandit
        ? cbQueries.map((q) => ({
            id: q.id,
            name: q.name,
            userIdType: q.userIdType,
            targetingAttributeColumns: q.targetingAttributeColumns,
          }))
        : (exposureQueries ?? []),
    [contextualBandit, cbQueries, exposureQueries],
  );

  const selectedExposureQuery = useMemo(
    () => assignmentQueriesForPicker.find((q) => q.id === exposureQueryId),
    [assignmentQueriesForPicker, exposureQueryId],
  );

  const datasourcesForPicker = datasources;

  useEffect(() => {
    if (!assignmentQueriesForPicker.length) return;
    if (!assignmentQueriesForPicker.find((q) => q.id === exposureQueryId)) {
      form.setValue("exposureQueryId", assignmentQueriesForPicker[0]?.id ?? "");
    }
  }, [assignmentQueriesForPicker, exposureQueryId, form]);

  useEffect(() => {
    if (contextualBandit) {
      form.setValue("disableStickyBucketing", true);
      form.setValue("secondaryMetrics", []);
      form.setValue("guardrailMetrics", []);
      form.setValue("customMetricSlices", []);
    }
  }, [contextualBandit, form]);

  const attributeSchema = useAttributeSchema(false, project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithNoBucketingV2 = !allConnectionsSupportBucketingV2(
    sdkConnectionsData?.connections,
    project,
  );

  const settings = useOrgSettings();
  const { namespaces } = useOrgSettings();

  // Contextual bandits skip the targeting step (arm weights come from
  // targeting attribute contexts), shifting the metrics step from 3 to 2.
  const showTargetingStep = !contextualBandit;
  const metricsStep = contextualBandit ? 2 : 3;

  return (
    <>
      {step === 0 ? (
        <>
          <Field
            required={true}
            minLength={2}
            label="Bandit Name"
            {...form.register("name")}
          />

          <Field
            label="Tracking Key"
            {...form.register(`trackingKey`)}
            placeholder={feature?.id || ""}
            helpText="Unique identifier for this Bandit, used to track impressions and analyze results"
          />

          <Field
            label="Description"
            textarea
            minRows={1}
            maxLength={MAX_DESCRIPTION_LENGTH}
            {...form.register("description")}
            placeholder="Short human-readable description of the Bandit"
          />

          {envScope && <RuleEnvironmentScopeField {...envScope} my="5" />}

          {!hideContextualBanditToggle && (
            <PremiumTooltip
              commercialFeature="contextual-bandits"
              body={
                hasContextualBanditFeature
                  ? null
                  : "Contextual Bandits are available on the Enterprise plan."
              }
            >
              <Checkbox
                mt="5"
                value={contextualBandit && hasContextualBanditFeature}
                setValue={(v) => {
                  if (v && !hasContextualBanditFeature) return;
                  setContextualBandit(v);
                }}
                disabled={!hasContextualBanditFeature}
                label="Make My Bandit Contextual"
              />
            </PremiumTooltip>
          )}
        </>
      ) : null}

      {step === 1 ? (
        <>
          <div className="mb-4">
            <Text as="label" weight="semibold" mb="1">
              Assign Variation by Attribute
            </Text>
            <Text as="div" color="text-mid" mb="2">
              Will be hashed together with the Tracking Key to determine which
              variation to assign
            </Text>
            <SelectField
              withRadixThemedPortal
              containerClassName="flex-1"
              options={attributeSchema
                .filter((s) => !hasHashAttributes || s.hashAttribute)
                .map((s) => ({
                  label: s.property,
                  value: s.property,
                  description: s.description,
                  tags: s.tags,
                  datatype: s.datatype,
                  hashAttribute: s.hashAttribute,
                }))}
              value={form.watch("hashAttribute")}
              onChange={(v) => {
                form.setValue("hashAttribute", v);
              }}
              formatOptionLabel={(o, meta) => {
                return (
                  <AttributeOptionWithTooltip
                    option={o as AttributeOptionForTooltip}
                    context={meta.context}
                  >
                    {o.label}
                  </AttributeOptionWithTooltip>
                );
              }}
            />
            <FallbackAttributeSelector
              form={form}
              attributeSchema={attributeSchema}
            />

            {hasSDKWithNoBucketingV2 && (
              <HashVersionSelector
                value={(form.watch("hashVersion") || 1) as 1 | 2}
                onChange={(v) => form.setValue("hashVersion", v)}
                project={project}
              />
            )}
          </div>

          <FeatureVariationsInput
            simple={true}
            hideCoverage={contextualBandit}
            label={
              contextualBandit ? "Variations" : "Traffic Percent & Variations"
            }
            defaultValue={feature ? getFeatureDefaultValue(feature) : undefined}
            valueType={feature?.valueType ?? "string"}
            coverageLabel="Traffic included in this Bandit"
            coverageTooltip={`Users not included in the Bandit will skip this ${source}`}
            coverage={coverage}
            setCoverage={setCoverage}
            setWeight={setWeight}
            variations={variations}
            setVariations={setVariations}
            feature={feature}
          />

          {namespaces && namespaces.length > 0 && (
            <div className="mt-4">
              <NamespaceSelector
                form={form}
                formPrefix={namespaceFormPrefix}
                trackingKey={form.watch("trackingKey") || feature?.id}
                featureId={feature?.id || ""}
                experimentHashAttribute={form.watch("hashAttribute")}
                fallbackAttribute={form.watch("fallbackAttribute")}
              />
            </div>
          )}
        </>
      ) : null}

      {showTargetingStep && step === 2 ? (
        <>
          <TargetingFieldsGroup
            project={project || ""}
            environments={environments ?? []}
            feature={feature}
            savedGroups={savedGroupValue}
            setSavedGroups={setSavedGroupValue}
            condition={defaultConditionValue}
            setCondition={setConditionValue}
            conditionKey={conditionKey}
            prerequisites={prerequisiteValue}
            setPrerequisites={setPrerequisiteValue}
            setPrerequisiteTargetingSdkIssues={
              setPrerequisiteTargetingSdkIssues
            }
            onRuleCyclicChange={onRuleCyclicChange}
          />
          {isCyclic ? (
            <Callout status="error" mt="3">
              A prerequisite (<code>{cyclicFeatureId}</code>) creates a circular
              dependency. Remove this prerequisite to continue.
            </Callout>
          ) : null}
        </>
      ) : null}

      {step === metricsStep ? (
        <>
          <div className="rounded px-3 pt-3 pb-1 bg-highlight mb-4">
            <SelectField
              label="Data Source"
              labelClassName="font-weight-bold"
              helpText={
                contextualBandit
                  ? "Only data sources with an Experiment Assignment Table that has targeting attributes can power a Contextual Bandit."
                  : undefined
              }
              value={form.watch("datasource") ?? ""}
              onChange={(newDatasource) => {
                form.setValue("datasource", newDatasource);
                if (!newDatasource) {
                  form.setValue("goalMetrics", []);
                  return;
                }
                const isValidMetric = (id: string) =>
                  getExperimentMetricById(id)?.datasource === newDatasource;
                const goalMetrics = (form.watch("goalMetrics") ?? []).filter(
                  isValidMetric,
                );
                if (
                  goalMetrics.length !==
                  (form.watch("goalMetrics") ?? []).length
                ) {
                  form.setValue("goalMetrics", goalMetrics);
                }
              }}
              options={datasourcesForPicker.map((d) => {
                const isDefaultDataSource = d.id === settings.defaultDataSource;
                return {
                  value: d.id,
                  label: `${d.name}${
                    d.description ? ` — ${d.description}` : ""
                  }${isDefaultDataSource ? " (default)" : ""}`,
                };
              })}
              className="portal-overflow-ellipsis"
            />

            {(
              contextualBandit
                ? !!datasource
                : datasource?.properties?.exposureQueries && exposureQueries
            ) ? (
              <>
                {contextualBandit && assignmentQueriesForPicker.length === 0 ? (
                  <Callout status="warning" mt="3" contentsAs="div">
                    No Contextual Bandit queries exist for this data source yet.{" "}
                    <Link
                      href="#"
                      className="underline"
                      onClick={(e) => {
                        e.preventDefault();
                        setCbQueryModalOpen(true);
                      }}
                    >
                      Add one
                    </Link>
                    .
                  </Callout>
                ) : null}
                {(!contextualBandit ||
                  assignmentQueriesForPicker.length > 0) && (
                  <SelectField
                    label={
                      <>
                        {contextualBandit
                          ? "Contextual Bandit Query"
                          : "Experiment Assignment Table"}{" "}
                        <Tooltip body="Should correspond to the Identifier Type used to randomize units for this experiment" />
                      </>
                    }
                    labelClassName="font-weight-bold"
                    value={form.watch("exposureQueryId") ?? ""}
                    onChange={(v) => form.setValue("exposureQueryId", v)}
                    required
                    options={assignmentQueriesForPicker.map((q) => {
                      return {
                        label: q.name,
                        value: q.id,
                      };
                    })}
                    formatOptionLabel={({ label, value }) => {
                      const userIdType = assignmentQueriesForPicker.find(
                        (e) => e.id === value,
                      )?.userIdType;
                      return (
                        <>
                          {label}
                          {userIdType ? (
                            <span
                              className="text-muted small float-right position-relative"
                              style={{ top: 3 }}
                            >
                              Identifier Type: <code>{userIdType}</code>
                            </span>
                          ) : null}
                        </>
                      );
                    }}
                  />
                )}
                {contextualBandit && selectedExposureQuery ? (
                  <Box mt="2">
                    <strong className="font-weight-semibold">
                      Targeting Attributes:{" "}
                    </strong>
                    {(
                      selectedExposureQuery.targetingAttributeColumns ?? []
                    ).map((d, i) => (
                      <Fragment key={d}>
                        {i ? ", " : ""}
                        <code>{d}</code>
                      </Fragment>
                    ))}
                    {!(selectedExposureQuery.targetingAttributeColumns ?? [])
                      .length && <em className="text-muted">none</em>}
                  </Box>
                ) : null}
                {contextualBandit && assignmentQueriesForPicker.length > 0 ? (
                  <Box mt="2">
                    <Link
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setCbQueryModalOpen(true);
                      }}
                    >
                      + Add Contextual Bandit query
                    </Link>
                  </Box>
                ) : null}
                {contextualBandit && cbQueryModalOpen && datasource ? (
                  <AddEditContextualBanditQueryModal
                    dataSource={datasource}
                    mode="add"
                    onSave={async (q) => {
                      await mutateCbQueries();
                      form.setValue("exposureQueryId", q.id);
                      setCbQueryModalOpen(false);
                    }}
                    onCancel={() => setCbQueryModalOpen(false)}
                  />
                ) : null}
              </>
            ) : null}
          </div>

          <Box my="4">
            <BanditSettings page="experiment-settings" />
          </Box>

          {settings?.useStickyBucketing && !contextualBandit && (
            <Switch
              label="Disable Sticky Bucketing"
              description="Permit users in low-performing variations to switch variations in future update periods."
              value={!!form.watch("disableStickyBucketing")}
              onChange={(v) => {
                form.setValue("disableStickyBucketing", v);
              }}
              mb="5"
              mt="5"
            />
          )}

          <Separator my="5" size="4" />

          <BanditDecisionMetricSettings
            disableBanditConversionWindow={disableBanditConversionWindow}
            setDisableBanditConversionWindow={setDisableBanditConversionWindow}
            project={project}
            contextualBandit={contextualBandit}
          />

          {!contextualBandit && (
            <ExperimentMetricsSelector
              datasource={datasource?.id}
              exposureQueryId={exposureQueryId}
              project={project}
              goalMetrics={form.watch("goalMetrics") ?? []}
              secondaryMetrics={form.watch("secondaryMetrics") ?? []}
              guardrailMetrics={form.watch("guardrailMetrics") ?? []}
              setSecondaryMetrics={(secondaryMetrics) =>
                form.setValue("secondaryMetrics", secondaryMetrics)
              }
              setGuardrailMetrics={(guardrailMetrics) =>
                form.setValue("guardrailMetrics", guardrailMetrics)
              }
              collapseSecondary={true}
              collapseGuardrail={true}
            />
          )}

          <CustomMetricSlicesSelector
            hidden={contextualBandit}
            goalMetrics={form.watch("goalMetrics") ?? []}
            secondaryMetrics={form.watch("secondaryMetrics") ?? []}
            guardrailMetrics={form.watch("guardrailMetrics") ?? []}
            customMetricSlices={form.watch("customMetricSlices") ?? []}
            setCustomMetricSlices={(slices) =>
              form.setValue("customMetricSlices", slices)
            }
          />

          {!contextualBandit && (
            <>
              <hr className="mt-4" />

              <Collapsible
                trigger={
                  <div className="link-purple font-weight-bold mt-4 mb-2">
                    <PiCaretRightFill className="chevron mr-1" />
                    Advanced Settings
                  </div>
                }
                transitionTime={100}
              >
                <div className="rounded px-3 pt-3 pb-1 bg-highlight">
                  <StatsEngineSelect
                    className="mb-4"
                    label={
                      <>
                        <div>Statistics Engine</div>
                        <div className="small text-muted">
                          Only <strong>Bayesian</strong> is available for Bandit
                          Experiments.
                        </div>
                      </>
                    }
                    value={"bayesian"}
                    allowUndefined={false}
                    disabled={true}
                  />

                  <SelectField
                    className="mb-4"
                    label={
                      <PremiumTooltip commercialFeature="regression-adjustment">
                        <GBCuped /> Use Regression Adjustment (CUPED)
                      </PremiumTooltip>
                    }
                    labelClassName="font-weight-bold"
                    value={
                      form.watch("regressionAdjustmentEnabled") ? "on" : "off"
                    }
                    onChange={(v) => {
                      form.setValue("regressionAdjustmentEnabled", v === "on");
                    }}
                    options={[
                      {
                        label: "On",
                        value: "on",
                      },
                      {
                        label: "Off",
                        value: "off",
                      },
                    ]}
                    disabled={!hasRegressionAdjustmentFeature}
                  />
                </div>
              </Collapsible>
            </>
          )}
        </>
      ) : null}
    </>
  );
}

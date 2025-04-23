import { useFormContext } from "react-hook-form";
import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { FaExclamationTriangle } from "react-icons/fa";
import { Box, TextField, Text, Flex, Grid } from "@radix-ui/themes";
import {
  PiCaretUp,
  PiCaretDown,
  PiLockBold,
  PiLockOpenBold,
} from "react-icons/pi";
import { useState } from "react";
import FeatureValueField from "@/components/Features/FeatureValueField";
import SelectField from "@/components/Forms/SelectField";
import { NewExperimentRefRule, useAttributeSchema } from "@/services/features";
import SavedGroupTargetingField from "@/components/Features/SavedGroupTargetingField";
import ConditionInput from "@/components/Features/ConditionInput";
import PrerequisiteTargetingField from "@/components/Features/PrerequisiteTargetingField";
import { useDefinitions } from "@/services/DefinitionsContext";
import MetricsSelector from "@/components/Experiment/MetricsSelector";
import Checkbox from "@/components/Radix/Checkbox";
import useOrgSettings from "@/hooks/useOrgSettings";
import HelperText from "@/components/Radix/HelperText";

export default function SafeRolloutFields({
  feature,
  environment,
  version,
  revisions,
  setPrerequisiteTargetingSdkIssues,
  isCyclic,
  cyclicFeatureId,
  conditionKey,
  isNewRule,
  isDraft,
  duplicate,
}: {
  feature: FeatureInterface;
  environment: string;
  defaultValues: FeatureRule | NewExperimentRefRule;
  version: number;
  revisions?: FeatureRevisionInterface[];
  setPrerequisiteTargetingSdkIssues: (b: boolean) => void;
  isCyclic: boolean;
  cyclicFeatureId: string | null;
  conditionKey: number;
  scheduleToggleEnabled: boolean;
  setScheduleToggleEnabled: (b: boolean) => void;
  isNewRule: boolean;
  isDraft: boolean;
  duplicate: boolean;
}) {
  const form = useFormContext();
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);
  const attributeSchema = useAttributeSchema(false, feature.project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;
  const { datasources } = useDefinitions();
  const [controlValueDisabled, setControlValueDisabled] = useState(true);
  const dataSourceOptions =
    datasources?.map((ds) => ({
      label: ds.name,
      value: ds.id,
    })) || [];
  const dataSource = datasources?.find(
    (ds) => ds.id === form.watch("safeRolloutFields.datasourceId")
  );
  const settings = useOrgSettings();
  const exposureQueries = dataSource?.settings?.queries?.exposure || [];
  const disableFields = !isDraft && !isNewRule;

  const durationValue = form.watch("safeRolloutFields.maxDuration.amount");
  const unit = form.watch("safeRolloutFields.maxDuration.unit") || "days";

  const unitMultipliers = {
    days: 24 * 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    minutes: 60 * 1000,
  };

  const dateMonitoredUntil = durationValue
    ? new Date(
        new Date().getTime() + durationValue * (unitMultipliers[unit] || 0)
      )
    : null;

  const renderTargeting = () => {
    return (
      <>
        <SavedGroupTargetingField
          value={form.watch("savedGroups") || []}
          setValue={(savedGroups) => form.setValue("savedGroups", savedGroups)}
          project={feature.project || ""}
        />
        <hr />
        <ConditionInput
          defaultValue={form.watch("condition") || ""}
          onChange={(value) => form.setValue("condition", value)}
          key={conditionKey}
          project={feature.project || ""}
        />
        <hr />
        <PrerequisiteTargetingField
          value={form.watch("prerequisites") || []}
          setValue={(prerequisites) =>
            form.setValue("prerequisites", prerequisites)
          }
          feature={feature}
          revisions={revisions}
          version={version}
          environments={[environment]}
          setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
        />
        {isCyclic && (
          <div className="alert alert-danger">
            <FaExclamationTriangle /> A prerequisite (
            <code>{cyclicFeatureId}</code>) creates a circular dependency.
            Remove this prerequisite to continue.
          </div>
        )}

        {duplicate && !!form.watch("seed") && (
          <div
            className="ml-auto link-purple cursor-pointer mb-2"
            onClick={(e) => {
              e.preventDefault();
              setAdvancedOptionsOpen(!advancedOptionsOpen);
            }}
          >
            Advanced Options{" "}
            {!advancedOptionsOpen ? <PiCaretDown /> : <PiCaretUp />}
          </div>
        )}
        {duplicate && !!form.watch("seed") && advancedOptionsOpen && (
          <div className="ml-2">
            <Checkbox
              value={form.watch("sameSeed")}
              setValue={(value: boolean) => form.setValue("sameSeed", value)}
              label="Same seed"
            />
          </div>
        )}
      </>
    );
  };

  const renderDataAndMetrics = () => {
    return (
      <>
        <SelectField
          disabled={disableFields}
          label="Split based on attribute"
          options={attributeSchema
            .filter((s) => !hasHashAttributes || s.hashAttribute)
            .map((s) => ({ label: s.property, value: s.property }))}
          value={form.watch("hashAttribute")}
          onChange={(v) => {
            form.setValue("hashAttribute", v);
          }}
          className="mb-4"
          required
        />
        <div className="bg-highlight rounded p-3 mb-4">
          <div className="mb-3 pb-1">
            <SelectField
              label="Data source"
              options={datasources.map((d) => {
                const isDefaultDataSource = d.id === settings.defaultDataSource;
                return {
                  value: d.id,
                  label: `${d.name}${
                    d.description ? ` — ${d.description}` : ""
                  }${isDefaultDataSource ? " (default)" : ""}`,
                };
              })}
              value={form.watch("safeRolloutFields.datasourceId")}
              onChange={(v) =>
                form.setValue("safeRolloutFields.datasourceId", v)
              }
              required
              placeholder="Select a data source"
              // Add a disabled state while loading
              disabled={!dataSourceOptions || disableFields}
            />
            {dataSourceOptions.length === 0 && (
              <div className="alert alert-warning mt-2">
                <small>
                  No data sources configured. Please add a data source in the
                  settings.
                </small>
              </div>
            )}
          </div>
          <div className="pb-1">
            <SelectField
              label="Experiment assignment table"
              options={exposureQueries.map((q) => ({
                label: q.name,
                value: q.id,
              }))}
              required
              disabled={
                disableFields || !form.watch("safeRolloutFields.datasourceId")
              }
              value={form.watch("safeRolloutFields.exposureQueryId")}
              onChange={(v) =>
                form.setValue("safeRolloutFields.exposureQueryId", v)
              }
            />
          </div>
          <div className="pb-1 ">
            <Text as="label" size="2" weight="medium">
              Guardrail metrics
              <Text size="1" as="div" weight="regular" color="gray">
                Metrics to monitor during safe rollout
              </Text>
            </Text>

            {/* TODO validate at least one metric is selected */}
            <MetricsSelector
              datasource={form.watch("safeRolloutFields.datasourceId")}
              exposureQueryId={form.watch("safeRolloutFields.exposureQueryId")}
              project={feature.project}
              selected={
                form.watch("safeRolloutFields.guardrailMetricIds") || []
              }
              disabled={!form.watch("safeRolloutFields.exposureQueryId")}
              onChange={(v) =>
                form.setValue("safeRolloutFields.guardrailMetricIds", v)
              }
            />
          </div>
          <div className="mb-3 pb-1">
            <Text as="label" size="2" weight="medium">
              Duration to monitor guardrail results
              <Text size="1" as="div" weight="regular" color="gray">
                Monitor for regressions and receive recommendations based on
                guardrail metric results
              </Text>
            </Text>
            <Box maxWidth="100px">
              <TextField.Root
                placeholder="7"
                type="number"
                disabled={
                  form.watch("status") === "stopped" ||
                  form.watch("status") === "rolled-back" ||
                  form.watch("status") === "released"
                }
                required
                {...form.register("safeRolloutFields.maxDuration.amount", {
                  valueAsNumber: true,
                })}
              >
                <TextField.Slot></TextField.Slot>
                <TextField.Slot>Days</TextField.Slot>
              </TextField.Root>
            </Box>
            {dateMonitoredUntil && !isNaN(dateMonitoredUntil.getTime()) && (
              <HelperText status="info" size="sm" mt="2">
                Feature will be monitored until{" "}
                {dateMonitoredUntil.toLocaleDateString()} if started today
              </HelperText>
            )}
          </div>
        </div>
      </>
    );
  };
  const renderVariationFieldSelector = () => {
    return (
      <>
        <Grid
          columns="auto auto 1fr 1fr"
          rows="auto auto auto"
          gapX="5"
          gapY="3"
          align={feature.valueType === "json" ? "start" : "center"}
          mb="6"
        >
          <Text as="label" weight="medium">
            Variation
          </Text>
          <Text as="label" weight="medium">
            Traffic
          </Text>
          <Text as="label" weight="medium">
            Value to Force
          </Text>
          <Flex align="end" justify="end">
            {!disableFields && (
              <Text
                color="purple"
                size="1"
                weight="medium"
                style={{ cursor: "pointer" }}
                onClick={() => {
                  setControlValueDisabled(!controlValueDisabled);
                }}
              >
                {controlValueDisabled ? (
                  <>
                    <PiLockBold /> Unlock to edit &apos;Control&apos;
                  </>
                ) : (
                  <>
                    <PiLockOpenBold /> Lock editing &apos;Control&apos;
                  </>
                )}
              </Text>
            )}
          </Flex>

          <Text as="label">Control</Text>
          <Text>50%</Text>
          <Box width="100%" style={{ gridColumn: "3 / span 2" }}>
            <FeatureValueField
              id="controlValue"
              value={form.watch("controlValue")}
              setValue={(v) => form.setValue("controlValue", v)}
              valueType={feature.valueType}
              feature={feature}
              renderJSONInline={true}
              disabled={disableFields || controlValueDisabled}
              useDropdown={true}
            />
          </Box>
          <Box
            style={{
              gridColumn: "1 / 5",
              borderBottom: "1px solid var(--gray-6)",
              height: "1px",
              margin: "0.5rem 0",
            }}
          />
          <Text as="label">Rollout value</Text>
          <Text as="label">50%</Text>
          <Box width="100%" style={{ gridColumn: "3 / span 2" }}>
            <FeatureValueField
              id="variationValue"
              value={form.watch("variationValue")}
              setValue={(v) => form.setValue("variationValue", v)}
              valueType={feature.valueType}
              feature={feature}
              renderJSONInline={true}
              disabled={disableFields}
              useDropdown={true}
            />
          </Box>
        </Grid>
      </>
    );
  };

  return (
    <>
      <Text size="2" as="div" mb="4" color="gray">
        Run an A/B test for a short period of time while monitoring guardrail
        metrics for regressions. Based on the results, choose whether to revert
        the feature or release it to 100% of users.
      </Text>
      <Text as="label" weight="medium" size="2" mb="2">
        Description
      </Text>
      <TextField.Root
        mb="6"
        {...form.register("description")}
        placeholder="Short human-readable description of the safe rollout"
      />
      {renderVariationFieldSelector()}
      {renderDataAndMetrics()}
      {renderTargeting()}
    </>
  );
}

import { useEffect, useId, useState } from "react";
import { useFormContext } from "react-hook-form";
import { Box } from "@radix-ui/themes";
import { CustomField } from "shared/types/custom-fields";
import { ExperimentValue, FeatureInterface } from "shared/types/feature";
import { ExperimentTemplateInterface } from "shared/types/experiment";
import { generateVariationId } from "shared/util";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import AIRichTextField from "@/components/Markdown/AIRichTextField";
import { useSuggestHypothesis } from "@/components/Experiment/useSuggestHypothesis";
import CustomFieldInput from "@/components/CustomFields/CustomFieldInput";
import SDKCapabilityWarning from "@/components/Features/SDKCapabilityWarning";
import NewRuleVariationsGrid from "@/components/Features/RuleModal/NewRuleVariationsGrid";
import { newRuleVariation } from "@/services/ruleVariations";
import Collapse, { CollapseLink } from "@/ui/Collapse";
import { CoverageField } from "@/components/Features/FeatureVariationsInput";
import ExperimentSplitVisual from "@/components/Features/ExperimentSplitVisual";
import {
  formatAttributeOptionLabel,
  toAttributeOption,
} from "@/components/Features/AttributeOptionTooltip";
import RuleEnvironmentScopeField, {
  type EnvScopeProps,
} from "@/components/Features/RuleModal/EnvironmentScopeField";
import RuleProjectScopeField, {
  type ProjectScopeProps,
} from "@/components/Features/RuleModal/ProjectScopeField";
import {
  getFeatureDefaultValue,
  resolveAttributeFilter,
  useAttributeSchema,
} from "@/services/features";
import { convertTemplateToExperimentRule } from "@/services/experiments";
import { useUser } from "@/services/UserContext";
import { useTemplates } from "@/hooks/useTemplates";
import useOrgSettings from "@/hooks/useOrgSettings";
import useExperimentKeyFieldProps from "@/hooks/useExperimentKeyFieldProps";
import Text from "@/ui/Text";

/**
 * A new experiment or Bandit for a rule, on one page laid out as Create
 * Experiment is, plus what the rule needs: each variation's value and where
 * the rule applies. The rest is set up on the experiment's page.
 */
export default function NewExperimentRuleFields({
  kind,
  feature,
  attributeProjects,
  attributeSelectIndicator,
  envScope,
  projectScope,
  customFields,
  customFieldValues,
  setCustomFields,
  setHypothesisUploading,
  templates,
  templateRequired,
}: {
  kind: "experiment" | "bandit";
  feature: FeatureInterface;
  attributeProjects?: string[] | null;
  attributeSelectIndicator?: React.ReactNode;
  envScope?: EnvScopeProps;
  projectScope?: ProjectScopeProps;
  customFields: CustomField[];
  customFieldValues: Record<string, string>;
  setCustomFields: (value: Record<string, string>) => void;
  setHypothesisUploading: (uploading: boolean) => void;
  // The rule modal's, which also enforces the requirement on submit.
  templates: ExperimentTemplateInterface[];
  templateRequired: boolean;
}) {
  const form = useFormContext();
  const settings = useOrgSettings();
  const { hasCommercialFeature } = useUser();
  const { templatesMap } = useTemplates();
  const trackingKeyFormatProps = useExperimentKeyFieldProps(
    form.watch("trackingKey"),
  );
  const project = feature.project || "";
  const defaultValue = getFeatureDefaultValue(feature);

  const availableTemplates =
    kind === "experiment"
      ? templates
          .slice()
          .sort((a, b) =>
            a.templateMetadata.name > b.templateMetadata.name ? 1 : -1,
          )
          .map((t) => ({ value: t.id, label: t.templateMetadata.name }))
      : [];

  const attributeSchema = useAttributeSchema(
    false,
    resolveAttributeFilter(attributeProjects, project),
  );
  const hashableAttributes = attributeSchema.filter((a) => a.hashAttribute);
  // Asked only when there's a choice, as Create Experiment does.
  const askHashAttribute =
    attributeSchema.length > 0 && hashableAttributes.length !== 1;

  const hypothesisLabelId = useId();
  const suggestHypothesis = useSuggestHypothesis(
    form.watch("hypothesis") ?? "",
    "new-experiment-rule",
  );

  const storedValues: (ExperimentValue & { id?: string })[] =
    form.watch("values") ?? [];
  // Each variation needs an id that holds across renders, as a row key.
  const missingIds = storedValues.some((v) => !v.id);
  useEffect(() => {
    if (!missingIds) return;
    form.setValue(
      "values",
      storedValues.map((v) => ({ ...v, id: v.id || generateVariationId() })),
    );
  }, [missingIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const variations = storedValues.map((v, i) => ({
    value: v.value || "",
    name: v.name || (i ? `Variation ${i}` : "Control"),
    weight: v.weight,
    id: v.id || String(i),
  }));
  const setVariations = (next: typeof variations) =>
    form.setValue("values", next);
  const coverage = form.watch("coverage") ?? 1;
  const setCoverage = (next: number) => form.setValue("coverage", next);
  const noun = kind === "bandit" ? "Bandit" : "experiment";

  // A Bandit's count keeps the values already set, and fills in new ones.
  const [typedCount, setTypedCount] = useState<string | null>(null);
  const applyCount = (n: number) => {
    const next = Array.from(
      { length: n },
      (_, i) =>
        variations[i] ?? newRuleVariation(feature.valueType, defaultValue, i),
    );
    setVariations(next.map((v) => ({ ...v, weight: 1 / n })));
  };
  // Applied as it's typed, so a submit by Enter uses it; clamped on blur.
  const typeCount = (raw: string) => {
    setTypedCount(raw);
    const n = parseInt(raw);
    if (n >= 2 && n <= 100 && n !== variations.length) applyCount(n);
  };
  const settleCount = (raw: string) => {
    setTypedCount(null);
    applyCount(Math.min(Math.max(2, parseInt(raw) || 2), 100));
  };
  const [valuesOpen, setValuesOpen] = useState(false);

  return (
    <>
      <SDKCapabilityWarning
        capability="bucketingV2"
        project={project}
        someMessage="Using V1 hashing algorithm as some of your SDK Connections may not support V2 hashing."
        noneMessage="Using V1 hashing algorithm as none of your SDK Connections support V2 hashing."
        popoverTriggerText="Show incompatible SDKs"
        size="medium"
      />
      <Field
        label={kind === "bandit" ? "Bandit name" : "Experiment name"}
        required
        minLength={2}
        {...form.register("name")}
      />
      {settings.experimentKeyRegexValidator && (
        <Field
          label="Tracking key"
          {...form.register("trackingKey")}
          {...trackingKeyFormatProps}
        />
      )}

      {hasCommercialFeature("templates") && availableTemplates.length >= 1 && (
        <SelectField
          label={
            <PremiumTooltip commercialFeature="templates">
              Template
            </PremiumTooltip>
          }
          value={form.watch("templateId") ?? ""}
          onChange={(t) => {
            if (!t) {
              form.setValue("templateId", undefined);
              form.reset();
              return;
            }
            form.setValue("templateId", t);
            const template = templatesMap.get(t);
            if (!template) return;
            form.reset(
              convertTemplateToExperimentRule({
                template,
                defaultValue,
                attributeSchema,
              }),
              { keepDefaultValues: true },
            );
          }}
          name="template"
          initialOption="None"
          options={availableTemplates}
          helpText={
            templateRequired
              ? "Your organization requires experiments to be created from a template"
              : undefined
          }
          required={templateRequired}
        />
      )}

      <Box mb="3">
        <Box id={hypothesisLabelId} mb="1">
          <Text as="label" weight="semibold">
            Hypothesis
          </Text>
        </Box>
        <AIRichTextField
          value={form.watch("hypothesis") ?? ""}
          onChange={(hypothesis) => form.setValue("hypothesis", hypothesis)}
          placeholder="e.g. Making the signup button bigger will increase clicks and ultimately improve revenue"
          height="xs"
          collapsibleToolbar
          aiSuggestFunction={suggestHypothesis}
          aiButtonText="Check hypothesis"
          trackingSource="new-experiment-rule"
          onUploadingChange={setHypothesisUploading}
          ariaLabelledBy={hypothesisLabelId}
        />
      </Box>

      {askHashAttribute && (
        <SelectField
          required
          label={
            <>
              <Text weight="semibold" mb="1">
                Assignment attribute
              </Text>
              <Text as="div" color="text-mid">
                Will be hashed together with the tracking key to determine which
                variation to assign
              </Text>
            </>
          }
          extraIndicator={attributeSelectIndicator}
          value={form.watch("hashAttribute") ?? ""}
          onChange={(v) => form.setValue("hashAttribute", v)}
          options={(hashableAttributes.length
            ? hashableAttributes
            : attributeSchema
          ).map(toAttributeOption)}
          formatOptionLabel={formatAttributeOptionLabel}
        />
      )}

      <CoverageField
        label={`Traffic included in this ${noun}`}
        tooltip={`Users not included in the ${noun} will skip this rule`}
        coverage={coverage}
        setCoverage={setCoverage}
        disabled={false}
        panel
      >
        {kind === "experiment" ? (
          <Box pb="4">
            <ExperimentSplitVisual
              coverage={coverage}
              values={variations}
              type={feature.valueType}
            />
          </Box>
        ) : null}
      </CoverageField>
      {kind === "bandit" ? (
        <>
          <Field
            label="Number of variations"
            type="number"
            min={2}
            max={100}
            style={{ width: 120 }}
            value={typedCount ?? String(variations.length)}
            onChange={(e) => typeCount(e.target.value)}
            onBlur={(e) => settleCount(e.target.value)}
          />
          <Box mb="4">
            <CollapseLink open={valuesOpen} onOpenChange={setValuesOpen}>
              Variation values
            </CollapseLink>
            <Collapse open={valuesOpen}>
              <Box pt="2">
                <NewRuleVariationsGrid
                  feature={feature}
                  defaultValue={defaultValue}
                  variations={variations}
                  setVariations={setVariations}
                  sparse={!!form.watch("sparse")}
                  setSparse={(sparse) => form.setValue("sparse", sparse)}
                  hideSplits
                  hideAddVariation
                />
              </Box>
            </Collapse>
          </Box>
        </>
      ) : (
        <NewRuleVariationsGrid
          feature={feature}
          defaultValue={defaultValue}
          variations={variations}
          setVariations={setVariations}
          sparse={!!form.watch("sparse")}
          setSparse={(sparse) => form.setValue("sparse", sparse)}
        />
      )}

      {envScope && <RuleEnvironmentScopeField {...envScope} my="5" />}
      {projectScope && <RuleProjectScopeField {...projectScope} mb="5" />}

      {customFields.length > 0 && (
        <CustomFieldInput
          fields={customFields}
          value={customFieldValues}
          onChange={setCustomFields}
        />
      )}
    </>
  );
}

import { useFormContext } from "react-hook-form";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { FeatureInterface } from "shared/types/feature";
import { FaExternalLinkAlt } from "react-icons/fa";
import { date } from "shared/dates";
import { Box, Flex } from "@radix-ui/themes";
import { getLatestPhaseVariations } from "shared/experiments";
import {
  parsePlainJSONObject,
  stripDefaultsForSparse,
  expandSparseToFull,
} from "shared/util";
import {
  useConfigBacking,
  useSeedConfigBackedVariations,
} from "@/hooks/useConfigBacking";
import Link from "@/ui/Link";
import Field from "@/components/Forms/Field";
import FeatureValueField from "@/components/Features/FeatureValueField";
import SelectField from "@/components/Forms/SelectField";
import {
  getDefaultVariationValue,
  getFeatureDefaultValue,
} from "@/services/features";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import { useExperiments } from "@/hooks/useExperiments";
import HelperText from "@/ui/HelperText";
import Callout from "@/ui/Callout";
import RuleEnvironmentScopeField, {
  type EnvScopeProps,
} from "@/components/Features/RuleModal/EnvironmentScopeField";
import RuleProjectScopeField, {
  type ProjectScopeProps,
} from "@/components/Features/RuleModal/ProjectScopeField";
import SparsePatchToggle from "@/components/Features/SparsePatchToggle";

export default function BanditRefFields({
  feature,
  existingRule,
  changeRuleType,
  envScope,
  projectScope,
}: {
  feature: FeatureInterface;
  existingRule: boolean;
  changeRuleType: (v: string) => void;
  envScope: EnvScopeProps;
  projectScope: ProjectScopeProps;
}) {
  const form = useFormContext();

  const { experiments, experimentsMap } = useExperiments();
  const experimentId = form.watch("experimentId");
  const selectedExperiment = experimentsMap.get(experimentId) || null;

  // Config-backed JSON flags: each arm is a sparse patch serving the default's
  // config, so arms use the config-backing editor. Force sparse on and seed each
  // arm with the backing (mirrors ExperimentRefFields).
  const { defaultConfigKey, isConfigBacked, configBackingOptionKeys } =
    useConfigBacking(feature);
  useSeedConfigBackedVariations(form, { isConfigBacked, defaultConfigKey });

  const experimentOptions = experiments
    .filter(
      (e) =>
        e.type === "multi-armed-bandit" &&
        (e.id === experimentId ||
          (!e.archived &&
            e.status !== "stopped" &&
            (e.project || "") === (feature.project || ""))),
    )
    .sort((a, b) => b.dateCreated.localeCompare(a.dateCreated))
    .map((e) => ({
      label: e.name,
      value: e.id,
    }));

  return (
    <>
      {experimentOptions.length > 0 ? (
        <SelectField
          size="legacy"
          label="Bandit"
          initialOption="Choose One..."
          options={experimentOptions}
          readOnly={existingRule}
          disabled={existingRule}
          required
          sort={false}
          value={experimentId || ""}
          onChange={(experimentId) => {
            const exp = experimentsMap.get(experimentId);
            if (exp) {
              const controlValue = getFeatureDefaultValue(feature);
              const variationValue = getDefaultVariationValue(controlValue);
              // When sparse is on (e.g. org default), seed each variation as a
              // clean patch rather than the full default the rule is otherwise
              // populated with.
              const isSparse =
                !!form.watch("sparse") &&
                feature.valueType === "json" &&
                parsePlainJSONObject(controlValue) !== null;
              form.setValue("experimentId", experimentId);
              form.setValue(
                "variations",
                getLatestPhaseVariations(exp).map((v, i) => {
                  const raw = i ? variationValue : controlValue;
                  return {
                    variationId: v.id,
                    value: isSparse
                      ? stripDefaultsForSparse(raw, controlValue)
                      : raw,
                  };
                }),
              );
            }
          }}
          formatOptionLabel={({ value, label }) => {
            const exp = experimentsMap.get(value);
            if (exp) {
              return (
                <div className="d-flex flex-wrap">
                  <div className="flex">
                    <strong>{exp.name}</strong>
                  </div>
                  <div className="ml-4 text-muted">
                    Created: {date(exp.dateCreated)}
                  </div>
                  <div className="ml-auto">
                    <ExperimentStatusIndicator
                      experimentData={exp}
                      labelFormat="status-only"
                    />
                  </div>
                </div>
              );
            }
            return label;
          }}
        />
      ) : !existingRule ? (
        <Callout status="warning" mb="4">
          {experiments.length > 0
            ? `You don't have any eligible Bandits yet.`
            : `You don't have any existing Bandits yet.`}{" "}
          <a
            role="button"
            className="link-purple"
            onClick={(e) => {
              e.preventDefault();
              changeRuleType("experiment-ref-new");
              form.setValue("experimentType", "multi-armed-bandit");
            }}
          >
            Create New Bandit
          </a>
        </Callout>
      ) : (
        <Callout status="error" mb="4">
          Could not find this Bandit. Has it been deleted?
        </Callout>
      )}
      {selectedExperiment && existingRule && (
        <HelperText status="info" mb="5">
          <Link
            href={`/bandit/${selectedExperiment.id}#overview`}
            target="_blank"
          >
            View this Bandit <FaExternalLinkAlt />
          </Link>{" "}
          to make changes to assignment or targeting conditions.
        </HelperText>
      )}

      {selectedExperiment && (
        <Box
          px="5"
          pt="5"
          pb="1"
          mb="4"
          className={isConfigBacked ? undefined : "bg-highlight rounded"}
        >
          <Flex align="center" gap="3" mb="3">
            <label className="mb-0">Variation Values</label>
            {feature.valueType === "json" &&
              !isConfigBacked &&
              parsePlainJSONObject(feature.defaultValue) !== null && (
                <SparsePatchToggle
                  checked={!!form.watch("sparse")}
                  onChange={(checked) => {
                    // Rewrite every variation value so the editor isn't left
                    // with a default-laden patch (on) or a bare patch shown as
                    // the full value (off).
                    const def = feature.defaultValue;
                    (form.getValues("variations") || []).forEach(
                      (variation, i) => {
                        form.setValue(
                          `variations.${i}.value`,
                          checked
                            ? stripDefaultsForSparse(variation.value, def)
                            : expandSparseToFull(variation.value, def),
                        );
                      },
                    );
                    form.setValue("sparse", checked);
                  }}
                />
              )}
          </Flex>
          {getLatestPhaseVariations(selectedExperiment).map((v, i) => (
            <FeatureValueField
              key={v.id}
              label={v.name}
              id={v.id}
              value={form.watch(`variations.${i}.value`) || ""}
              setValue={(v) => form.setValue(`variations.${i}.value`, v)}
              valueType={feature.valueType}
              feature={feature}
              renderJSONInline={false}
              useCodeInput={true}
              showFullscreenButton={true}
              codeInputDefaultHeight={80}
              sparse={!!form.watch("sparse")}
              allowConfigBacking={isConfigBacked}
              configBackingOptionKeys={configBackingOptionKeys}
              configBackingShowPatch={isConfigBacked}
              lockConfigBacking={isConfigBacked}
            />
          ))}
        </Box>
      )}

      <Field
        size="legacy"
        label="Description"
        textarea
        minRows={1}
        maxLength={MAX_DESCRIPTION_LENGTH}
        {...form.register("description")}
        placeholder="Short human-readable description of the rule"
      />

      <RuleEnvironmentScopeField {...envScope} my="5" />
      <RuleProjectScopeField {...projectScope} mb="5" />
    </>
  );
}

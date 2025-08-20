import { useFormContext } from "react-hook-form";
import { FeatureInterface } from "back-end/types/feature";
import { FaExternalLinkAlt } from "react-icons/fa";
import { date } from "shared/dates";
import Link from "next/link";
import Field from "@/components/Forms/Field";
import FeatureValueField from "@/components/Features/FeatureValueField";
import SelectField from "@/components/Forms/SelectField";
import {
  getDefaultVariationValue,
  getFeatureDefaultValue,
  getRules,
} from "@/services/features";
import StatusIndicator from "@/components/Experiment/StatusIndicator";
import TargetingInfo from "@/components/Experiment/TabbedPage/TargetingInfo";
import { useExperiments } from "@/hooks/useExperiments";
import Callout from "@/components/Radix/Callout";

export default function BanditRefFields({
  feature,
  environment,
  i,
  changeRuleType,
}: {
  feature: FeatureInterface;
  environment: string;
  i: number;
  changeRuleType: (v: string) => void;
}) {
  const form = useFormContext();

  const { experiments, experimentsMap } = useExperiments();
  const experimentId = form.watch("experimentId");
  const selectedExperiment = experimentsMap.get(experimentId) || null;

  const rules = getRules(feature, environment);

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
      <div>
        {experimentOptions.length > 0 ? (
          <SelectField
            label="Bandit"
            initialOption="Choose One..."
            options={experimentOptions}
            readOnly={!!rules[i]}
            disabled={!!rules[i]}
            required
            sort={false}
            value={experimentId || ""}
            onChange={(experimentId) => {
              const exp = experimentsMap.get(experimentId);
              if (exp) {
                const controlValue = getFeatureDefaultValue(feature);
                const variationValue = getDefaultVariationValue(controlValue);
                form.setValue("experimentId", experimentId);
                form.setValue(
                  "variations",
                  exp.variations.map((v, i) => ({
                    variationId: v.id,
                    value: i ? variationValue : controlValue,
                  })),
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
                      <StatusIndicator
                        archived={exp.archived}
                        status={exp.status}
                      />
                    </div>
                  </div>
                );
              }
              return label;
            }}
          />
        ) : !rules[i] ? (
          <div className="alert alert-warning">
            <div className="d-flex align-items-center">
              {experiments.length > 0
                ? `You don't have any eligible Bandits yet.`
                : `You don't have any existing Bandits yet.`}{" "}
              <button
                type="button"
                className="btn btn-primary ml-auto"
                onClick={(e) => {
                  e.preventDefault();
                  changeRuleType("experiment-ref-new");
                  form.setValue("experimentType", "multi-armed-bandit");
                }}
              >
                Create New Bandit
              </button>
            </div>
          </div>
        ) : (
          <div className="alert alert-danger">
            Could not find this Bandit. Has it been deleted?
          </div>
        )}

        {selectedExperiment && rules[i] && (
          <div className="appbox px-3 pt-3">
            <Callout status="info" mb="5">
              <Link href={`/bandit/${selectedExperiment.id}#overview`}>
                View this Bandit <FaExternalLinkAlt />
              </Link>{" "}
              to make changes to assignment or targeting conditions.
            </Callout>
            <TargetingInfo experiment={selectedExperiment} />
          </div>
        )}
        {selectedExperiment && (
          <div className="form-group">
            <label>Variation Values</label>
            <div className="mb-3 box p-3">
              {selectedExperiment.variations.map((v, i) => (
                <FeatureValueField
                  key={v.id}
                  label={v.name}
                  id={v.id}
                  value={form.watch(`variations.${i}.value`) || ""}
                  setValue={(v) => form.setValue(`variations.${i}.value`, v)}
                  valueType={feature.valueType}
                  feature={feature}
                  renderJSONInline={false}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <Field
        label="Description"
        textarea
        minRows={1}
        {...form.register("description")}
        placeholder="Short human-readable description of the rule"
      />
    </>
  );
}

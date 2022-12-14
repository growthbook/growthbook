import Link from "next/link";
import { FC } from "react";
import { useForm } from "react-hook-form";
import { IdeaInterface } from "back-end/types/idea";
import { ImpactEstimateInterface } from "back-end/types/impact-estimate";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "../Modal";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";

const ImpactModal: FC<{
  idea?: IdeaInterface;
  estimate?: ImpactEstimateInterface;
  close: () => void;
  mutate: () => void;
}> = ({ idea, estimate, close, mutate }) => {
  const { metrics, getMetricById, segments } = useDefinitions();

  const { apiCall } = useAuth();

  const form = useForm({
    defaultValues: {
      metric: estimate?.metric || metrics[0]?.id || "",
      segment: estimate?.segment || "",
      userAdjustment: idea.estimateParams?.userAdjustment || 100,
      numVariations: idea.estimateParams?.numVariations || 2,
      improvement: idea.estimateParams?.improvement || 10,
    },
  });

  const possibleMetrics = metrics.filter(
    // TODO: support non-binomial and manual metrics
    (m) => m.type === "binomial" && m.datasource
  );

  const metric = getMetricById(form.watch("metric"));

  const datasource = metric?.datasource;
  const possibleSegments = segments.filter((s) => s.datasource == datasource);

  return (
    <Modal
      header="Impact Score Parameters"
      open={true}
      submit={form.handleSubmit(async (value) => {
        // Need an API call to get an updated estimate
        let est = estimate;
        if (
          !estimate ||
          estimate.metric !== value.metric ||
          (estimate.segment || "") !== value.segment
        ) {
          const res = await apiCall<{ estimate: ImpactEstimateInterface }>(
            `/ideas/impact`,
            {
              method: "POST",
              body: JSON.stringify({
                metric: value.metric,
                segment: value.segment || null,
              }),
            }
          );
          est = res.estimate;
        }

        if (!est) {
          throw new Error(
            "Failed to get user and page data from the data source"
          );
        }

        const adjustedValue =
          est.conversionsPerDay * (value.userAdjustment / 100);

        const sampleSize = (150 - 2 * value.improvement) * value.numVariations;

        const days = adjustedValue ? sampleSize / adjustedValue : 7;
        const experimentLength = days < 7 ? 7 : days;

        const improvementAdjustment = value.improvement < 5 ? 0.5 : 1;

        const trafficAdjustment = value.userAdjustment / 100;

        const impact =
          (trafficAdjustment * improvementAdjustment * 7) / experimentLength;

        const data: Partial<IdeaInterface> = {
          impactScore: est.conversionsPerDay ? Math.floor(impact * 100) : 0,
          experimentLength,
          estimateParams: {
            estimate: est.id,
            improvement: value.improvement,
            numVariations: value.numVariations,
            userAdjustment: value.userAdjustment,
          },
        };

        await apiCall(`/idea/${idea.id}`, {
          method: "POST",
          body: JSON.stringify(data),
        });
        mutate();
      })}
      cta="Save"
      close={close}
    >
      <SelectField
        label="Primary Metric"
        value={form.watch("metric")}
        onChange={(v) => form.setValue("metric", v)}
        options={possibleMetrics.map((m) => ({
          value: m.id,
          label: m.name,
        }))}
        autoFocus={true}
        helpText="Only binomial metrics are supported at this time"
      />
      <Field
        label="Effect Size"
        {...form.register("improvement", { valueAsNumber: true })}
        options={[
          { display: "Tiny (<1%)", value: "1" },
          { display: "Small (5%)", value: "5" },
          { display: "Medium (10%)", value: "10" },
          { display: "Large (20%)", value: "20" },
          { display: "Huge (50%)", value: "50" },
        ]}
        helpText="How much do you think this will improve the metric?"
      />
      <Field
        label="Number of Variations"
        type="number"
        min="2"
        max="20"
        step="1"
        {...form.register("numVariations", { valueAsNumber: true })}
        helpText="Including the baseline"
      />
      <Field
        label="Percent of Total Traffic"
        {...form.register("userAdjustment", {
          valueAsNumber: true,
        })}
        type="number"
        step="1"
        min="0"
        max="100"
        append="%"
        helpText="If this experiment is on a subset of your application, approx what percent of users will see it?"
      />
      <SelectField
        label="User Segment"
        disabled={!possibleSegments?.length}
        value={form.watch("segment")}
        onChange={(v) => form.setValue("segment", v)}
        initialOption="Everyone"
        options={possibleSegments.map((s) => ({
          value: s.id,
          label: s.name,
        }))}
        helpText={
          !possibleSegments?.length ? (
            <>
              No segments defined for the selected metric&apos;s datasource.{" "}
              <Link href="/segments">
                <a>Add Segments</a>
              </Link>
              .
            </>
          ) : null
        }
      />
    </Modal>
  );
};

export default ImpactModal;

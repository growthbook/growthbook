import Link from "next/link";
import { FC } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import { IdeaInterface } from "back-end/types/idea";
import { ImpactEstimateInterface } from "back-end/types/impact-estimate";
import Modal from "../Modal";
import { useDefinitions } from "../../services/DefinitionsContext";
import Field from "../Forms/Field";

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
      page: estimate?.regex || ".*",
      userAdjustment: idea.estimateParams?.userAdjustment || 100,
      numVariations: idea.estimateParams?.numVariations || 2,
      improvement: idea.estimateParams?.improvement || 10,
    },
  });

  const possibleMetrics = metrics
    .filter(
      // TODO: support non-binomial and manual metrics
      (m) => m.type === "binomial" && m.datasource
    )
    .filter((m) => m.status !== "archived");

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
          estimate.regex !== value.page ||
          estimate.metric !== value.metric ||
          (estimate.segment || "") !== value.segment
        ) {
          const res = await apiCall<{ estimate: ImpactEstimateInterface }>(
            `/ideas/impact`,
            {
              method: "POST",
              body: JSON.stringify({
                metric: value.metric,
                regex: value.page,
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

        const cr = est.users ? est.value / est.users : 0;

        const trafficPerVariationPerDay =
          ((value.userAdjustment / 100) * est.users) / value.numVariations;

        const variance = cr * (1 - cr);

        const sampleSize =
          (15.3664 * variance) / Math.pow((value.improvement / 100) * cr, 2);

        const days = sampleSize / trafficPerVariationPerDay;
        const experimentLength = days < 7 ? 7 : days;

        const impact = (est.value / est.metricTotal) * (7 / experimentLength);

        const data: Partial<IdeaInterface> = {
          impactScore: Math.floor(impact * 100),
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
      <Field
        label="Primary Metric"
        {...form.register("metric")}
        options={possibleMetrics.map((m) => ({
          value: m.id,
          display: m.name,
        }))}
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
        label="Experiment URLs"
        {...form.register("page")}
        helpText="URLs where this experiment will run (regular expression)"
      />
      <Field
        label="User Segment"
        disabled={!possibleSegments?.length}
        {...form.register("segment")}
        initialOption="Everyone"
        options={possibleSegments.map((s) => ({
          value: s.id,
          display: s.name,
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

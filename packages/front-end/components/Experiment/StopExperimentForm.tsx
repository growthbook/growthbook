import { FC } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentResultsType,
} from "back-end/types/experiment";
import { useForm } from "react-hook-form";
import { experimentHasLinkedChanges } from "shared/util";
import { FaExclamationTriangle } from "react-icons/fa";
import { datetime } from "shared/dates";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import SelectField from "@/components/Forms/SelectField";
import Modal from "@/components/Modal";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import Field from "@/components/Forms/Field";
import Toggle from "@/components/Forms/Toggle";
import { DocLink } from "@/components/DocLink";
import DatePicker from "@/components/DatePicker";

const StopExperimentForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  close: () => void;
  source?: string;
}> = ({ experiment, close, mutate, source }) => {
  const isBandit = experiment.type == "multi-armed-bandit";
  const isStopped = experiment.status === "stopped";

  const hasLinkedChanges = experimentHasLinkedChanges(experiment);

  const phases = experiment.phases || [];
  const lastPhaseIndex = phases.length - 1;
  const lastPhase = phases[lastPhaseIndex];

  const percentFormatter = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 2,
  });

  const form = useForm({
    defaultValues: {
      reason: "",
      winner: experiment.winner || 0,
      releasedVariationId: experiment.releasedVariationId || "",
      excludeFromPayload: !!experiment.excludeFromPayload,
      analysis: experiment.analysis || "",
      results: experiment.results || "dnf",
      dateEnded: new Date().toISOString().substr(0, 16),
    },
  });

  const { apiCall } = useAuth();

  const submit = form.handleSubmit(async (value) => {
    let winner = -1;
    if (value.results === "lost") {
      winner = 0;
    } else if (value.results === "won") {
      if (experiment.variations.length === 2) {
        winner = 1;
      } else {
        winner = value.winner;
      }
    }

    const body = {
      ...value,
      winner,
    };

    await apiCall<{ status: number; message?: string }>(
      isStopped
        ? `/experiment/${experiment.id}`
        : `/experiment/${experiment.id}/stop`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

    if (!isStopped) {
      track("Stop Experiment", {
        result: value.results,
      });
    }

    mutate();
  });

  return (
    <Modal
      trackingEventModalType="stop-experiment-form"
      trackingEventModalSource={source}
      header={
        isStopped
          ? `Edit ${isBandit ? "Bandit" : "Experiment"} Results`
          : `Stop ${isBandit ? "Bandit" : "Experiment"}`
      }
      close={close}
      open={true}
      submit={submit}
      cta={isStopped ? "Save" : "Stop"}
      submitColor={isStopped ? "primary" : "danger"}
      closeCta="Cancel"
    >
      {!isStopped && (
        <>
          <Field
            label="Reason for stopping"
            textarea
            {...form.register("reason")}
            placeholder="(optional)"
          />
          {!hasLinkedChanges && (
            <DatePicker
              label="End Time (UTC)"
              date={form.watch("dateEnded")}
              setDate={(v) => {
                form.setValue("dateEnded", v ? datetime(v) : "");
              }}
            />
          )}
        </>
      )}
      <div className="row">
        <SelectField
          label="Conclusion"
          containerClassName="col-lg"
          value={form.watch("results")}
          onChange={(v) => {
            const result = v as ExperimentResultsType;
            form.setValue("results", result);

            if (result === "dnf" || result === "inconclusive") {
              form.setValue("excludeFromPayload", true);
              form.setValue("releasedVariationId", "");
              form.setValue("winner", 0);
            } else if (result === "won") {
              form.setValue("excludeFromPayload", false);
              form.setValue("winner", 1);
              form.setValue(
                "releasedVariationId",
                experiment.variations[1]?.id || ""
              );
            } else if (result === "lost") {
              form.setValue("excludeFromPayload", true);
              form.setValue("winner", 0);
              form.setValue(
                "releasedVariationId",
                experiment.variations[0]?.id || ""
              );
            }
          }}
          placeholder="Pick one..."
          required
          options={[
            { label: "Did Not Finish", value: "dnf" },
            { label: "Won", value: "won" },
            { label: "Lost", value: "lost" },
            { label: "Inconclusive", value: "inconclusive" },
          ]}
        />
        {form.watch("results") === "won" && experiment.variations.length > 2 && (
          <SelectField
            label="Winner"
            containerClassName="col-lg"
            value={form.watch("winner") + ""}
            onChange={(v) => {
              form.setValue("winner", parseInt(v) || 0);

              form.setValue(
                "releasedVariationId",
                experiment.variations[parseInt(v)]?.id ||
                  form.watch("releasedVariationId")
              );
            }}
            options={experiment.variations.slice(1).map((v, i) => {
              return { value: i + 1 + "", label: v.name };
            })}
          />
        )}
      </div>
      {hasLinkedChanges && (
        <>
          <div className="row">
            <div className="form-group col">
              <label>Enable Temporary Rollout</label>

              <div>
                <Toggle
                  id="excludeFromPayload"
                  value={!form.watch("excludeFromPayload")}
                  setValue={(includeInPayload) => {
                    form.setValue("excludeFromPayload", !includeInPayload);
                  }}
                />
              </div>

              <small className="form-text text-muted">
                Keep the {isBandit ? "Bandit" : "Experiment"} running until you
                can implement the changes in code.{" "}
                <DocLink docSection="temporaryRollout">Learn more</DocLink>
              </small>
            </div>
          </div>

          {!form.watch("excludeFromPayload") &&
          (lastPhase?.coverage ?? 1) < 1 ? (
            <div className="alert alert-warning">
              <FaExclamationTriangle className="mr-1" />
              Currently only{" "}
              <strong>{percentFormatter.format(lastPhase.coverage)}</strong> of
              traffic is directed at this experiment. Upon rollout,{" "}
              <strong>100%</strong> of traffic will be directed towards the
              released variation.
            </div>
          ) : null}

          {!form.watch("excludeFromPayload") ? (
            <div className="row">
              <SelectField
                label="Variation to Release"
                containerClassName="col"
                value={form.watch("releasedVariationId")}
                onChange={(v) => {
                  form.setValue("releasedVariationId", v);
                }}
                helpText="Send 100% of experiment traffic to this variation"
                placeholder="Pick one..."
                required
                options={experiment.variations.map((v) => {
                  return { value: v.id, label: v.name };
                })}
              />
            </div>
          ) : form.watch("results") === "won" ? (
            <div className="alert alert-info">
              If you don&apos;t enable a Temporary Rollout, all experiment
              traffic will immediately revert to the default control experience
              when you submit this form.
            </div>
          ) : null}
        </>
      )}

      <div className="row">
        <div className="form-group col-lg">
          <label>Additional Analysis or Details</label>{" "}
          <MarkdownInput
            value={form.watch("analysis")}
            setValue={(val) => form.setValue("analysis", val)}
          />
        </div>
      </div>
    </Modal>
  );
};

export default StopExperimentForm;

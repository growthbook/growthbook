import { FC } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentResultsType,
} from "back-end/types/experiment";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import SelectField from "@/components/Forms/SelectField";
import Modal from "../Modal";
import MarkdownInput from "../Markdown/MarkdownInput";
import Field from "../Forms/Field";

const StopExperimentForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  close: () => void;
}> = ({ experiment, close, mutate }) => {
  const isStopped = experiment.status === "stopped";

  const form = useForm({
    defaultValues: {
      reason: "",
      winner: experiment.winner || 0,
      releasedVariationId: experiment.releasedVariationId || "",
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
      header={isStopped ? "Edit Experiment Results" : "Stop Experiment"}
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
            label="Reason for stopping the test"
            textarea
            {...form.register("reason")}
            placeholder="(optional)"
          />
          <Field
            label="Stop Time (UTC)"
            type="datetime-local"
            {...form.register("dateEnded")}
          />
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
          }}
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
            }}
            options={experiment.variations.slice(1).map((v, i) => {
              return { value: i + 1 + "", label: v.name };
            })}
          />
        )}
      </div>
      <div className="row">
        <SelectField
          label="Variation to Release"
          containerClassName="col"
          value={form.watch("releasedVariationId")}
          onChange={(v) => {
            form.setValue("releasedVariationId", v);
          }}
          helpText="Which variation should be rolled out to 100% of users?"
          initialOption="None"
          options={experiment.variations.map((v) => {
            return { value: v.id, label: v.name };
          })}
        />
      </div>
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

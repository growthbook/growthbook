import { FC } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useForm } from "react-hook-form";
import Modal from "../Modal";
import { useAuth } from "../../services/auth";
import MarkdownInput from "../Markdown/MarkdownInput";
import track from "../../services/track";

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
          <div className="form-group">
            <label>Reason for stopping the test</label>
            <textarea
              className="form-control"
              {...form.register("reason")}
              placeholder="(optional)"
            />
          </div>
          <div className="form-group">
            <label>Stop Time (UTC)</label>
            <input
              type="datetime-local"
              className="form-control"
              {...form.register("dateEnded")}
            />
          </div>
        </>
      )}
      <div className="row">
        <div className={`form-group col-lg`}>
          <label>Conclusion</label>
          <select className="form-control" {...form.register("results")}>
            <option value="dnf">Did Not Finish</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="inconclusive">Inconclusive</option>
          </select>
        </div>
        {form.watch("results") === "won" && experiment.variations.length > 2 && (
          <div className={`form-group col-lg`}>
            <label>Winner</label>
            <select className="form-control" {...form.register("winner")}>
              {experiment.variations.map((v, i) => {
                if (!i) return null;
                return (
                  <option value={i} key={i}>
                    {v.name}
                  </option>
                );
              })}
            </select>
          </div>
        )}
      </div>
      <div className="row">
        <div className="form-group col-lg">
          <label>Additional Analysis or Details</label>{" "}
          <MarkdownInput form={form} name="analysis" />
        </div>
      </div>
    </Modal>
  );
};

export default StopExperimentForm;

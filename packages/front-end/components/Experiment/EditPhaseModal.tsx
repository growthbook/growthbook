import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import Field from "../Forms/Field";
import Modal from "../Modal";
import { getEvenSplit } from "../../services/utils";
import { useAuth } from "../../services/auth";

export interface Props {
  close: () => void;
  i: number;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
}

export default function EditPhaseModal({
  close,
  i,
  experiment,
  mutate,
}: Props) {
  const form = useForm<ExperimentPhaseStringDates>({
    defaultValues: {
      ...experiment.phases[i],
      dateStarted: experiment.phases[i].dateStarted.substr(0, 16),
      dateEnded: experiment.phases[i].dateEnded
        ? experiment.phases[i].dateEnded.substr(0, 16)
        : "",
    },
  });
  const { apiCall } = useAuth();

  const weights = form.watch("variationWeights");
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  const validWeights = weightSum >= 0.99 && weightSum <= 1.01;

  return (
    <Modal
      open={true}
      close={close}
      header={`Edit Analysis Phase #${i + 1}`}
      submit={form.handleSubmit(async (value) => {
        await apiCall(`/experiment/${experiment.id}/phase/${i}`, {
          method: "PUT",
          body: JSON.stringify(value),
        });
        mutate();
      })}
    >
      <Field
        label="Type of Phase"
        {...form.register("phase")}
        options={[
          "ramp",
          { value: "main", display: "main (default)" },
          "holdout",
        ]}
      />
      <Field
        label="Start Time (UTC)"
        type="datetime-local"
        {...form.register("dateStarted")}
      />
      <Field
        label="End Time (UTC)"
        type="datetime-local"
        {...form.register("dateEnded")}
        helpText="Leave blank if still running"
      />
      {form.watch("dateEnded") && (
        <Field
          label="Reason for Stopping"
          textarea
          {...form.register("reason")}
          placeholder="(optional)"
        />
      )}
      <Field
        label="Percent of Traffic (0 to 1)"
        {...form.register("coverage", { valueAsNumber: true })}
        type="number"
        min="0"
        max="1"
        step="0.01"
      />
      <div className="form-group">
        <div className="d-flex align-items-center">
          <label>Traffic Split</label>
          <div className="ml-auto">
            <button
              className="btn btn-sm btn-outline-primary w-100"
              onClick={(e) => {
                e.preventDefault();
                form.setValue(
                  "variationWeights",
                  getEvenSplit(experiment.variations.length)
                );
              }}
            >
              Even Split
            </button>
          </div>
        </div>
        <div className="row">
          {experiment.variations.map((v, i) => (
            <div className={`col-auto mb-2`} key={i}>
              <Field
                type="number"
                min="0"
                max="1"
                step="0.01"
                prepend={v.name}
                {...form.register(`variationWeights.${i}`, {
                  valueAsNumber: true,
                })}
              />
            </div>
          ))}
        </div>
        {!validWeights && (
          <div className="alert alert-danger">
            Variation weights must add to 1
          </div>
        )}
      </div>
    </Modal>
  );
}

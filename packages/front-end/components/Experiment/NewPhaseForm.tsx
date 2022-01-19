import { FC } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { useForm } from "react-hook-form";
import Modal from "../Modal";
import { useAuth } from "../../services/auth";
import { useWatching } from "../../services/WatchProvider";
import { getEvenSplit } from "../../services/utils";
import GroupsInput from "../GroupsInput";
import { useDefinitions } from "../../services/DefinitionsContext";
import Field from "../Forms/Field";
import { useFeature } from "@growthbook/growthbook-react";

const NewPhaseForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  close: () => void;
}> = ({ experiment, close, mutate }) => {
  const { refreshWatching } = useWatching();

  const firstPhase = !experiment.phases.length;

  const prevPhase: Partial<ExperimentPhaseStringDates> =
    experiment.phases[experiment.phases.length - 1] || {};

  const form = useForm({
    defaultValues: {
      phase: prevPhase.phase || "main",
      coverage: prevPhase.coverage || 1,
      variationWeights:
        prevPhase.variationWeights ||
        getEvenSplit(experiment.variations.length),
      reason: "",
      dateStarted: new Date().toISOString().substr(0, 16),
      groups: prevPhase.groups || [],
    },
  });

  const { refreshGroups } = useDefinitions();

  const { apiCall } = useAuth();

  const variationWeights = form.watch("variationWeights");

  const showGroups = useFeature("show-experiment-groups").on;

  // Make sure variation weights add up to 1 (allow for a little bit of rounding error)
  const totalWeights = variationWeights.reduce(
    (total: number, weight: number) => total + weight,
    0
  );
  const isValid = totalWeights > 0.99 && totalWeights < 1.01;

  const submit = form.handleSubmit(async (value) => {
    if (!isValid) throw new Error("Variation weights must sum to 1");

    const body = {
      ...value,
    };

    await apiCall<{ status: number; message?: string }>(
      `/experiment/${experiment.id}/phase`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );
    await refreshGroups(value.groups);
    mutate();
    refreshWatching();
  });

  const maxSplitCols = experiment.variations.length > 2 ? 6 : 3;
  const splitCols = Math.max(
    Math.round(12 / experiment.variations.length - 1),
    maxSplitCols
  );

  return (
    <Modal
      header={firstPhase ? "Start Experiment" : "New Experiment Phase"}
      close={close}
      open={true}
      submit={submit}
      cta={"Start"}
      closeCta="Cancel"
      size="lg"
    >
      {!firstPhase && (
        <div className="alert alert-warning">
          Changing the traffic percent or split will start a new phase of the
          experiment. All previously collected results data will be archived and
          it will start fresh from this point on.
        </div>
      )}
      <div className="row">
        {!firstPhase && (
          <Field
            containerClassName="col-12"
            label="Reason for Starting New Phase"
            textarea
            {...form.register("reason")}
            placeholder="(optional)"
          />
        )}
        <Field
          containerClassName="col-12"
          label="Start Time (UTC)"
          type="datetime-local"
          {...form.register("dateStarted")}
        />
      </div>
      <div className="row">
        <Field
          label="Type of Phase"
          containerClassName="col-lg"
          {...form.register("phase")}
          options={[
            "ramp",
            { value: "main", display: "main (default)" },
            "holdout",
          ]}
        />
        <Field
          label="Percent of Traffic (0 to 1)"
          containerClassName="col-lg"
          {...form.register("coverage", { valueAsNumber: true })}
          type="number"
          min="0"
          max="1"
          step="0.01"
        />
      </div>
      <div className="row">
        <div className="col-md">
          <label>Traffic Split</label>
          <div className="row">
            {experiment.variations.map((v, i) => (
              <div className={`col-${splitCols} mb-2`} key={i}>
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
            <div className="col">
              <button
                className="btn btn-outline-primary w-100"
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
          {!isValid && (
            <div className="alert alert-danger">
              The total traffic split must add up to 1
            </div>
          )}
        </div>
      </div>
      {(experiment.implementation === "visual" || showGroups) && (
        <div className="row">
          <div className="col">
            <label>User Groups (optional)</label>
            <GroupsInput
              value={form.watch("groups")}
              onChange={(groups) => {
                form.setValue("groups", groups);
              }}
            />
            <small className="form-text text-muted">
              Use this to limit your experiment to specific groups of users
              (e.g. &quot;internal&quot;, &quot;beta-testers&quot;,
              &quot;qa&quot;).
            </small>
          </div>
        </div>
      )}
      <div style={{ height: 150 }} />
    </Modal>
  );
};

export default NewPhaseForm;

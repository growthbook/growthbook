import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import Field from "../Forms/Field";
import Modal from "../Modal";
import { validateSavedGroupTargeting } from "../Features/SavedGroupTargetingField";

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
      dateStarted: (experiment.phases[i].dateStarted ?? "").substr(0, 16),
      dateEnded: experiment.phases[i].dateEnded
        ? (experiment.phases[i].dateEnded ?? "").substr(0, 16)
        : "",
    },
  });
  const { apiCall } = useAuth();

  const isDraft = experiment.status === "draft";
  const isMultiPhase = experiment.phases.length > 1;

  const hasLinkedChanges =
    !!experiment.linkedFeatures?.length || experiment.hasVisualChangesets;

  return (
    <Modal
      open={true}
      close={close}
      header={`Edit Analysis Phase #${i + 1}`}
      submit={form.handleSubmit(async (value) => {
        validateSavedGroupTargeting(value.savedGroups);

        await apiCall(`/experiment/${experiment.id}/phase/${i}`, {
          method: "PUT",
          body: JSON.stringify(value),
        });
        mutate();
      })}
      size="lg"
      bodyClassName="px-4 pt-4"
    >
      {!isDraft && hasLinkedChanges && (
        <div className="alert alert-danger">
          <strong>Warning:</strong> Changes you make to phases will immediately
          affect all linked Feature Flags and Visual Changes.
        </div>
      )}
      <Field label="Phase Name" {...form.register("name")} required />
      <Field
        label="Start Time (UTC)"
        type="datetime-local"
        {...form.register("dateStarted")}
      />
      {!(isDraft && !isMultiPhase) ? (
        <>
          <Field
            label="End Time (UTC)"
            type="datetime-local"
            {...form.register("dateEnded")}
            helpText={
              <>
                Leave blank if still running.{" "}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    form.setValue("dateEnded", "");
                  }}
                >
                  Clear Input
                </a>
              </>
            }
          />
          {form.watch("dateEnded") && (
            <Field
              label="Reason for Stopping"
              textarea
              {...form.register("reason")}
              placeholder="(optional)"
            />
          )}
        </>
      ) : null}
    </Modal>
  );
}

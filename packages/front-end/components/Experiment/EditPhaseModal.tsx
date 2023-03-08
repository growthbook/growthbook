import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  Variation,
} from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import Field from "../Forms/Field";
import Modal from "../Modal";
import FeatureVariationsInput from "../Features/FeatureVariationsInput";

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
  const form = useForm<
    ExperimentPhaseStringDates & { variations: Variation[] }
  >({
    defaultValues: {
      ...experiment.phases[i],
      dateStarted: experiment.phases[i].dateStarted.substr(0, 16),
      dateEnded: experiment.phases[i].dateEnded
        ? experiment.phases[i].dateEnded.substr(0, 16)
        : "",
      variations: experiment.variations,
    },
  });
  const { apiCall } = useAuth();

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
      size="lg"
    >
      <Field label="Phase Name" {...form.register("name")} required />
      <Field
        label="Start Time (UTC)"
        type="datetime-local"
        {...form.register("dateStarted")}
      />
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

      <FeatureVariationsInput
        valueType={"string"}
        coverage={form.watch("coverage")}
        setCoverage={(coverage) => form.setValue("coverage", coverage)}
        setWeight={(i, weight) =>
          form.setValue(`variationWeights.${i}`, weight)
        }
        valueAsId={true}
        variations={
          form.watch("variations").map((v, i) => {
            return {
              value: v.key || i + "",
              name: v.name,
              weight: form.watch(`variationWeights.${i}`),
              id: v.id,
            };
          }) || []
        }
        coverageTooltip="This is just for documentation purposes and has no effect on the analysis."
        showPreview={false}
      />
    </Modal>
  );
}

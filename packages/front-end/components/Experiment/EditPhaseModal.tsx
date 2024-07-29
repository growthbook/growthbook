import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { useState } from "react";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import { validateSavedGroupTargeting } from "@/components/Features/SavedGroupTargetingField";

export interface Props {
  close: () => void;
  i: number;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  editTargeting: (() => void) | null;
}

export default function EditPhaseModal({
  close,
  i,
  experiment,
  mutate,
  editTargeting,
}: Props) {
  const form = useForm<ExperimentPhaseStringDates>({
    defaultValues: {
      ...experiment.phases[i],
      seed: experiment.phases[i].seed ?? experiment.trackingKey,
      dateStarted: (experiment.phases[i].dateStarted ?? "").substr(0, 16),
      dateEnded: experiment.phases[i].dateEnded
        ? (experiment.phases[i].dateEnded ?? "").substr(0, 16)
        : "",
    },
  });
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);

  const { apiCall } = useAuth();

  const isDraft = experiment.status === "draft";
  const isMultiPhase = experiment.phases.length > 1;

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
                  role="button"
                  className="a"
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

      {!isDraft && (
        <div className="alert alert-info mt-4">
          Trying to change targeting rules, traffic allocation, or start a new
          phase? Use the{" "}
          <a
            role="button"
            className="a"
            onClick={() => {
              editTargeting?.();
              close();
            }}
          >
            Make Changes
          </a>{" "}
          button instead.
        </div>
      )}

      {advancedOptionsOpen && (
        //edit seed
        <Field
          label="Seed"
          type="input"
          {...form.register("seed")}
          helpText={
            <>
              <strong className="text-danger">Warning:</strong> Changing this
              will change bucketing for you variations.
            </>
          }
        />
      )}
      <span
        className="ml-auto link-purple cursor-pointer"
        onClick={(e) => {
          e.preventDefault();
          setAdvancedOptionsOpen(!advancedOptionsOpen);
        }}
      >
        Advanced Options{" "}
        {!advancedOptionsOpen ? <PiCaretDown /> : <PiCaretUp />}
      </span>
    </Modal>
  );
}

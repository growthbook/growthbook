import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "shared/types/experiment";
import { useState } from "react";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
import { datetime } from "shared/dates";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import { validateSavedGroupTargeting } from "@/components/Features/SavedGroupTargetingField";
import DatePicker from "@/components/DatePicker";

export interface Props {
  close: () => void;
  i: number;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  editTargeting: (() => void) | null;
  source?: string;
}

export default function EditPhaseModal({
  close,
  i,
  experiment,
  mutate,
  editTargeting,
  source,
}: Props) {
  const form = useForm<ExperimentPhaseStringDates>({
    defaultValues: {
      ...experiment.phases[i],
      seed: experiment.phases[i]?.seed ?? experiment.trackingKey,
      dateStarted: (experiment.phases[i]?.dateStarted ?? "").substr(0, 16),
      dateEnded: experiment.phases[i]?.dateEnded
        ? (experiment.phases[i]?.dateEnded ?? "").substr(0, 16)
        : "",
    },
  });
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);

  const { apiCall } = useAuth();

  const isDraft = experiment.status === "draft";
  const isMultiPhase = experiment.phases.length > 1;
  const isHoldout = experiment.type === "holdout";

  return (
    <Modal
      trackingEventModalType="edit-phase-modal"
      trackingEventModalSource={source}
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
      <DatePicker
        label="Start Time (UTC)"
        date={form.watch("dateStarted")}
        setDate={(v) => {
          form.setValue("dateStarted", v ? datetime(v) : "");
        }}
        scheduleEndDate={form.watch("dateEnded")}
        disableAfter={form.watch("dateEnded") || undefined}
      />
      {!(isDraft && !isMultiPhase) ? (
        <>
          <DatePicker
            label="End Time (UTC)"
            date={form.watch("dateEnded")}
            setDate={(v) => {
              form.setValue("dateEnded", v ? datetime(v) : "");
            }}
            scheduleStartDate={form.watch("dateStarted")}
            disableBefore={form.watch("dateStarted") || undefined}
            containerClassName=""
          />
          <div className="mb-3 mt-1 small">
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
          </div>
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

      {!isHoldout && !isDraft ? (
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
      ) : null}

      {!isHoldout ? (
        <>
          {advancedOptionsOpen && (
            //edit seed
            <Field
              label="Seed"
              type="input"
              {...form.register("seed")}
              helpText={
                <>
                  <strong className="text-danger">Warning:</strong> Changing
                  this will re-randomize experiment traffic.
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
        </>
      ) : null}
    </Modal>
  );
}

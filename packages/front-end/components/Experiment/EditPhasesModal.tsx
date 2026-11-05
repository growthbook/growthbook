import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { date, datetime } from "shared/dates";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
import { phaseSummary } from "@/services/utils";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import Field from "@/components/Forms/Field";
import DatePicker from "@/components/DatePicker";
import { validateSavedGroupTargeting } from "@/components/Features/SavedGroupTargetingField";
import { GBAddCircle } from "@/components/Icons";
import NewPhaseForm from "./NewPhaseForm";

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  linkedFeatures?: LinkedFeatureInfo[];
  mutateExperiment: () => void;
  editTargeting: (() => void) | null;
  source?: string;
}

export default function EditPhasesModal({
  close,
  experiment,
  linkedFeatures,
  mutateExperiment,
  editTargeting,
  source,
}: Props) {
  const isDraft = experiment.status === "draft";
  const isMultiPhase = experiment.phases.length > 1;
  const hasStoppedPhases = experiment.phases.some((p) => p.dateEnded);
  const hasLinkedChanges =
    !!experiment.linkedFeatures?.length || !!experiment.hasVisualChangesets;

  const [editPhase, setEditPhase] = useState<number | null>(
    isDraft && !isMultiPhase ? 0 : null,
  );

  const { apiCall } = useAuth();

  if (editPhase === -1) {
    return (
      <NewPhaseForm
        close={() => setEditPhase(null)}
        experiment={experiment}
        linkedFeatures={linkedFeatures}
        mutate={mutateExperiment}
      />
    );
  }

  if (editPhase !== null) {
    return (
      <EditPhaseStep
        close={() => {
          if (isDraft && !isMultiPhase) {
            close();
          } else {
            setEditPhase(null);
          }
        }}
        experiment={experiment}
        i={editPhase}
        mutate={mutateExperiment}
        onMakeChanges={() => {
          editTargeting?.();
          close();
        }}
      />
    );
  }
  return (
    <ModalStandard
      trackingEventModalType="edit-phases-modal"
      trackingEventModalSource={source}
      open={true}
      header="Edit Phases"
      close={close}
      size="lg"
    >
      <Box mb="2">
        <Table className="table gbtable responsive-table" variant="ghost">
          <TableHeader>
            <TableRow>
              <TableColumnHeader></TableColumnHeader>
              <TableColumnHeader>Name</TableColumnHeader>
              <TableColumnHeader>Dates (UTC)</TableColumnHeader>
              <TableColumnHeader>Traffic</TableColumnHeader>
              {hasStoppedPhases ? (
                <TableColumnHeader>Reason for Stopping</TableColumnHeader>
              ) : null}
              <TableColumnHeader></TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {experiment.phases.map((phase, i) => (
              <TableRow key={i}>
                <TableCell>{i + 1}</TableCell>
                <TableCell>{phase.name}</TableCell>
                <TableCell>
                  <strong
                    title={`${datetime(phase.dateStarted ?? "", "UTC")} UTC`}
                  >
                    {date(phase.dateStarted ?? "", "UTC")}
                  </strong>{" "}
                  to{" "}
                  <strong
                    title={
                      phase.dateEnded
                        ? `${datetime(phase.dateEnded, "UTC")} UTC`
                        : undefined
                    }
                  >
                    {phase.dateEnded ? date(phase.dateEnded, "UTC") : "now"}
                  </strong>
                </TableCell>
                <TableCell>{phaseSummary(phase)}</TableCell>
                {hasStoppedPhases ? (
                  <TableCell>
                    {phase.dateEnded ? (
                      phase.reason
                    ) : (
                      <em className="text-muted">not applicable</em>
                    )}
                  </TableCell>
                ) : null}
                <TableCell justify="end" style={{ width: 125 }}>
                  <Flex gap="2" justify="end" align="center">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditPhase(i);
                      }}
                    >
                      Edit
                    </Button>
                    {(experiment.status !== "running" || !hasLinkedChanges) &&
                      experiment.phases.length > 1 && (
                        <DeleteButton
                          text="Delete"
                          displayName="phase"
                          onClick={async () => {
                            await apiCall(
                              `/experiment/${experiment.id}/phase/${i}`,
                              {
                                method: "DELETE",
                              },
                            );
                            mutateExperiment();
                          }}
                        />
                      )}
                  </Flex>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      {/* A draft starts through its start flow, which the server requires. */}
      {!isDraft && (experiment.status !== "running" || !hasLinkedChanges) && (
        <Button
          icon={<GBAddCircle />}
          onClick={() => {
            setEditPhase(-1);
          }}
        >
          New Phase
        </Button>
      )}
    </ModalStandard>
  );
}

function EditPhaseStep({
  close,
  i,
  experiment,
  mutate,
  onMakeChanges,
}: {
  close: () => void;
  i: number;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  onMakeChanges: () => void;
}) {
  const form = useForm<ExperimentPhaseStringDates>({
    defaultValues: {
      ...experiment.phases[i],
      seed: experiment.phases[i]?.seed ?? experiment.trackingKey,
      dateStarted: experiment.phases[i]?.dateStarted ?? "",
      dateEnded: experiment.phases[i]?.dateEnded ?? "",
    },
  });
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);

  const { apiCall } = useAuth();

  const isDraft = experiment.status === "draft";
  const isMultiPhase = experiment.phases.length > 1;

  return (
    <ModalStandard
      trackingEventModalType="edit-phase-modal"
      trackingEventModalSource="edit-phases-modal"
      open={true}
      close={close}
      header={`Edit Analysis Phase #${i + 1}`}
      submit={validatedSubmit(form, async (value) => {
        validateSavedGroupTargeting(value.savedGroups);

        await apiCall(`/experiment/${experiment.id}/phase/${i}`, {
          method: "PUT",
          body: JSON.stringify(value),
        });
        mutate();
      })}
      size="lg"
    >
      <Field
        size="legacy"
        label="Phase Name"
        {...form.register("name")}
        required
      />
      <DatePicker
        label="Start time"
        timeZone="utc"
        date={form.watch("dateStarted")}
        setDate={(v) => {
          form.setValue("dateStarted", v ? v.toISOString() : "");
        }}
        scheduleEndDate={form.watch("dateEnded")}
        disableAfter={form.watch("dateEnded") || undefined}
      />
      {!(isDraft && !isMultiPhase) ? (
        <>
          <DatePicker
            label="End time"
            timeZone="utc"
            date={form.watch("dateEnded")}
            setDate={(v) => {
              form.setValue("dateEnded", v ? v.toISOString() : "");
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
              size="legacy"
              label="Reason for Stopping"
              textarea
              {...form.register("reason")}
              placeholder="(optional)"
            />
          )}
        </>
      ) : null}

      {!isDraft ? (
        <Callout status="info" mt="4">
          Trying to change targeting rules, traffic allocation, or start a new
          phase? Use the{" "}
          <a role="button" className="a" onClick={onMakeChanges}>
            Make Changes
          </a>{" "}
          button instead.
        </Callout>
      ) : null}

      {advancedOptionsOpen && (
        <Field
          size="legacy"
          label="Seed"
          type="input"
          {...form.register("seed")}
          helpText={
            <>
              <strong className="text-danger">Warning:</strong> Changing this
              will re-randomize experiment traffic.
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
    </ModalStandard>
  );
}

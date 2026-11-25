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
import { Trans, useLingui } from "@lingui/react/macro";
import { phaseSummary } from "@/services/utils";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
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
  const { t } = useLingui();
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
      header={t`Edit Phases`}
      close={close}
      size="lg"
    >
      <Box mb="2">
        <Table className="table gbtable responsive-table" variant="ghost">
          <TableHeader>
            <TableRow>
              <TableColumnHeader></TableColumnHeader>
              <TableColumnHeader>
                <Trans>Name</Trans>
              </TableColumnHeader>
              <TableColumnHeader>
                <Trans>Dates (UTC)</Trans>
              </TableColumnHeader>
              <TableColumnHeader>
                <Trans>Traffic</Trans>
              </TableColumnHeader>
              {hasStoppedPhases ? (
                <TableColumnHeader>
                  <Trans>Reason for Stopping</Trans>
                </TableColumnHeader>
              ) : null}
              <TableColumnHeader></TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {experiment.phases.map((phase, i) => {
              const startTitle = `${datetime(phase.dateStarted ?? "", "UTC")} UTC`;
              const startDate = date(phase.dateStarted ?? "", "UTC");
              const endTitle = phase.dateEnded
                ? `${datetime(phase.dateEnded, "UTC")} UTC`
                : undefined;
              const endDate = phase.dateEnded
                ? date(phase.dateEnded, "UTC")
                : t`now`;
              return (
                <TableRow key={i}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>{phase.name}</TableCell>
                  <TableCell>
                    <Trans>
                      <strong title={startTitle}>{startDate}</strong> to{" "}
                      <strong title={endTitle}>{endDate}</strong>
                    </Trans>
                  </TableCell>
                  <TableCell>{phaseSummary(phase)}</TableCell>
                  {hasStoppedPhases ? (
                    <TableCell>
                      {phase.dateEnded ? (
                        phase.reason
                      ) : (
                        <em className="text-muted">
                          <Trans>not applicable</Trans>
                        </em>
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
                        <Trans>Edit</Trans>
                      </Button>
                      {(experiment.status !== "running" || !hasLinkedChanges) &&
                        experiment.phases.length > 1 && (
                          <DeleteButton
                            text={t`Delete`}
                            displayName={t`phase`}
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
              );
            })}
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
          <Trans>New Phase</Trans>
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
  const { t } = useLingui();
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
  const phaseNumber = i + 1;

  return (
    <ModalStandard
      trackingEventModalType="edit-phase-modal"
      trackingEventModalSource="edit-phases-modal"
      open={true}
      close={close}
      header={t`Edit Analysis Phase #${phaseNumber}`}
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
        label={t`Phase Name`}
        {...form.register("name")}
        required
      />
      <DatePicker
        label={t`Start time`}
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
            label={t`End time`}
            timeZone="utc"
            date={form.watch("dateEnded")}
            setDate={(v) => {
              form.setValue("dateEnded", v ? v.toISOString() : "");
            }}
            scheduleStartDate={form.watch("dateStarted")}
            disableBefore={form.watch("dateStarted") || undefined}
            containerClassName=""
            clearButton
          />
          <Text as="div" size="sm" color="text-mid" mt="1" mb="3">
            <Trans>Leave blank if still running.</Trans>
          </Text>
          {form.watch("dateEnded") && (
            <Field
              size="legacy"
              label={t`Reason for Stopping`}
              textarea
              {...form.register("reason")}
              placeholder={t`(optional)`}
            />
          )}
        </>
      ) : null}

      {!isDraft ? (
        <Callout status="info" mt="4">
          <Trans>
            Trying to change targeting rules, traffic allocation, or start a new
            phase? Use the{" "}
            <a role="button" className="a" onClick={onMakeChanges}>
              Make Changes
            </a>{" "}
            button instead.
          </Trans>
        </Callout>
      ) : null}

      {advancedOptionsOpen && (
        <Field
          size="legacy"
          label={t`Seed`}
          type="input"
          {...form.register("seed")}
          helpText={
            <Trans>
              <strong className="text-danger">Warning:</strong> Changing this
              will re-randomize experiment traffic.
            </Trans>
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
        <Trans>Advanced Options</Trans>{" "}
        {!advancedOptionsOpen ? <PiCaretDown /> : <PiCaretUp />}
      </span>
    </ModalStandard>
  );
}

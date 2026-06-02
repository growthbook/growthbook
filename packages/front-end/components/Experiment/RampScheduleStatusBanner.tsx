/**
 * RampScheduleStatusBanner
 *
 * Shown on the experiment results page when the experiment has an active
 * ramp schedule. Displays the current step, hold reason (if any), and
 * action buttons for ramp operations.
 */
import { useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { RampScheduleInterface } from "shared/validators";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { isAwaitingApproval, isReadyForApproval } from "shared/validators";
import { FaCheckCircle, FaExclamationTriangle, FaPause, FaPlay, FaUndo } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import useApi from "@/hooks/useApi";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
}

const STATUS_COLORS: Record<
  RampScheduleInterface["status"],
  "indigo" | "yellow" | "green" | "red" | "gray"
> = {
  pending: "gray",
  ready: "yellow",
  running: "indigo",
  paused: "yellow",
  completed: "green",
  "rolled-back": "red",
};

const STATUS_LABELS: Record<RampScheduleInterface["status"], string> = {
  pending: "Pending",
  ready: "Ready to start",
  running: "Ramping",
  paused: "Paused",
  completed: "Completed",
  "rolled-back": "Rolled back",
};

export default function RampScheduleStatusBanner({ experiment, mutate }: Props) {
  const { apiCall } = useAuth();
  const [loading, setLoading] = useState(false);

  const { data, mutate: mutateSchedule } = useApi<{
    rampSchedule: RampScheduleInterface | null;
  }>(`/experiment/${experiment.id}/ramp-schedule`);

  const schedule = data?.rampSchedule;
  if (!experiment.rampScheduleId || !schedule) return null;
  if (!["pending", "ready", "running", "paused"].includes(schedule.status)) {
    // Still show completed/rolled-back for awareness
    if (schedule.status === "completed" || schedule.status === "rolled-back") {
      return (
        <Callout
          status={schedule.status === "completed" ? "success" : "error"}
          mb="3"
        >
          <Flex align="center" gap="2">
            {schedule.status === "completed" ? (
              <FaCheckCircle />
            ) : (
              <FaUndo />
            )}
            <Text>
              Ramp schedule {STATUS_LABELS[schedule.status].toLowerCase()}.
              {schedule.lastRollbackReason
                ? ` Reason: ${schedule.lastRollbackReason}`
                : ""}
            </Text>
          </Flex>
        </Callout>
      );
    }
    return null;
  }

  const now = new Date();
  const awaitingApproval = isAwaitingApproval(schedule);
  const readyForApproval = isReadyForApproval(schedule, now);
  const currentStep =
    schedule.currentStepIndex >= 0
      ? schedule.steps[schedule.currentStepIndex]
      : null;

  const doAction = async (
    action: string,
    body?: Record<string, unknown>,
  ) => {
    setLoading(true);
    try {
      await apiCall(`/experiment/${experiment.id}/ramp-schedule/${action}`, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
      mutateSchedule();
      mutate();
    } finally {
      setLoading(false);
    }
  };

  const totalSteps = schedule.steps.length;
  const stepLabel =
    schedule.currentStepIndex >= 0
      ? `Step ${schedule.currentStepIndex + 1} of ${totalSteps}`
      : "Not started";

  return (
    <Box
      className="appbox"
      p="3"
      mb="3"
      style={{ borderLeft: "4px solid var(--violet-8)" }}
    >
      <Flex justify="between" align="center" gap="3">
        <Flex align="center" gap="3">
          <Badge
            color={STATUS_COLORS[schedule.status]}
            label={STATUS_LABELS[schedule.status]}
          />
          <Text size="2" color="gray">
            {stepLabel}
          </Text>
          {currentStep && (
            <Text size="2" color="gray">
              ·{" "}
              {currentStep.monitored
                ? "Monitored step"
                : "Unmonitored step"}
            </Text>
          )}
          {awaitingApproval && (
            <Badge
              color="orange"
              variant="soft"
              label={
                <>
                  <FaExclamationTriangle style={{ marginRight: 4 }} />
                  Awaiting approval
                </>
              }
            />
          )}
        </Flex>

        <Flex gap="2" align="center">
          {/* Approval CTA */}
          {awaitingApproval && readyForApproval && (
            <Button
              size="sm"
              color="violet"
              loading={loading}
              onClick={() => doAction("approve-step")}
            >
              <FaCheckCircle className="mr-1" />
              Approve Step
            </Button>
          )}

          {/* Advance CTA (manual trigger) */}
          {schedule.status === "running" && !awaitingApproval && (
            <Button
              size="sm"
              variant="outline"
              loading={loading}
              onClick={() => doAction("advance")}
            >
              Advance
            </Button>
          )}

          {/* Pause / Resume */}
          {schedule.status === "running" && (
            <Button
              size="sm"
              variant="ghost"
              color="gray"
              loading={loading}
              onClick={() => doAction("pause")}
            >
              <FaPause className="mr-1" />
              Pause
            </Button>
          )}
          {schedule.status === "paused" && (
            <Button
              size="sm"
              variant="outline"
              color="violet"
              loading={loading}
              onClick={() => doAction("resume")}
            >
              <FaPlay className="mr-1" />
              Resume
            </Button>
          )}

          {/* Rollback CTA */}
          {(schedule.status === "running" || schedule.status === "paused") && (
            <Button
              size="sm"
              variant="ghost"
              color="red"
              loading={loading}
              onClick={() => {
                if (
                  confirm(
                    "Roll back this ramp? This will create a new experiment phase with the pre-ramp settings and reset sticky bucketing.",
                  )
                ) {
                  doAction("rollback");
                }
              }}
            >
              <FaUndo className="mr-1" />
              Rollback
            </Button>
          )}
        </Flex>
      </Flex>

      {/* Last rollback info */}
      {schedule.lastRollbackReason && schedule.status === "rolled-back" && (
        <Text size="1" color="red" mt="2" as="div">
          Rolled back: {schedule.lastRollbackReason}
        </Text>
      )}
    </Box>
  );
}

/**
 * RampScheduleMenuItems
 *
 * Ramp playback controls (approve / advance / pause / resume / roll back)
 * rendered under a "Ramp-up schedule" heading in the experiment's main actions
 * dropdown. Mirrors the feature-rule ramp menu's language and icons. Returns
 * null unless there's an active ramp with an applicable action, so it adds
 * nothing to the menu otherwise. Permission-gating is the caller's
 * responsibility (render only when the user can run the experiment).
 */
import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import {
  RampScheduleInterface,
  isAwaitingApproval,
  isReadyForApproval,
} from "shared/validators";
import {
  PiArrowUUpLeft,
  PiArrowUUpRight,
  PiCheck,
  PiPauseFill,
  PiPlayFill,
} from "react-icons/pi";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";

interface Props {
  experimentId: string;
  mutate: () => void;
  closeDropdown?: () => void;
}

export default function RampScheduleMenuItems({
  experimentId,
  mutate,
  closeDropdown,
}: Props) {
  const { apiCall } = useAuth();
  const [loading, setLoading] = useState(false);

  const { data, mutate: mutateSchedule } = useApi<{
    rampSchedule: RampScheduleInterface | null;
  }>(`/experiment/${experimentId}/ramp-schedule`);

  const schedule = data?.rampSchedule;
  if (!schedule) return null;
  if (schedule.status !== "running" && schedule.status !== "paused") {
    return null;
  }

  const awaitingApproval = isAwaitingApproval(schedule);
  const readyForApproval = isReadyForApproval(schedule, new Date());

  const doAction = async (action: string) => {
    if (loading) return;
    setLoading(true);
    try {
      await apiCall(`/experiment/${experimentId}/ramp-schedule/${action}`, {
        method: "POST",
      });
      mutateSchedule();
      mutate();
    } finally {
      setLoading(false);
      closeDropdown?.();
    }
  };

  const items: JSX.Element[] = [];

  if (awaitingApproval && readyForApproval) {
    items.push(
      <DropdownMenuItem
        key="approve"
        disabled={loading}
        onClick={() => doAction("approve-step")}
      >
        <Flex align="center" gap="2">
          <PiCheck /> Approve step
        </Flex>
      </DropdownMenuItem>,
    );
  }
  if (schedule.status === "running" && !awaitingApproval) {
    items.push(
      <DropdownMenuItem
        key="advance"
        disabled={loading}
        onClick={() => doAction("advance")}
      >
        <Flex align="center" gap="2">
          <PiArrowUUpRight /> Advance to next step
        </Flex>
      </DropdownMenuItem>,
    );
  }
  if (schedule.status === "running") {
    items.push(
      <DropdownMenuItem
        key="pause"
        disabled={loading}
        onClick={() => doAction("pause")}
      >
        <Flex align="center" gap="2">
          <PiPauseFill /> Pause
        </Flex>
      </DropdownMenuItem>,
    );
  }
  if (schedule.status === "paused") {
    items.push(
      <DropdownMenuItem
        key="resume"
        disabled={loading}
        onClick={() => doAction("resume")}
      >
        <Flex align="center" gap="2">
          <PiPlayFill /> Resume
        </Flex>
      </DropdownMenuItem>,
    );
  }
  // running || paused
  items.push(
    <DropdownMenuItem
      key="rollback"
      disabled={loading}
      confirmation={{
        submit: () => doAction("rollback"),
        confirmationTitle: "Roll back ramp?",
        cta: "Roll back",
        ctaColor: "red",
        getConfirmationContent: async () =>
          "This ends the current phase and starts a new one with the pre-ramp settings, resetting sticky bucketing. The experiment keeps running.",
        closeDropdown,
      }}
    >
      <Flex align="center" gap="2">
        <PiArrowUUpLeft /> Roll back
      </Flex>
    </DropdownMenuItem>,
  );

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup label="Ramp-up schedule">{items}</DropdownMenuGroup>
    </>
  );
}

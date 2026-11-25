import { useSWRConfig } from "swr";
import { PiInfo, PiX } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Link from "@/ui/Link";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { useAuth } from "@/services/auth";

export type DismissibleWarning = NonNullable<
  ExperimentInterfaceStringDates["dismissedWarnings"]
>[number];

export interface MuteAlert {
  isMuted: boolean;
  toggle: () => Promise<void>;
}

export function useMuteAlert(
  experiment: ExperimentInterfaceStringDates,
  warning: DismissibleWarning,
): MuteAlert {
  const { apiCall, orgId } = useAuth();
  const { mutate } = useSWRConfig();
  const isMuted = experiment.dismissedWarnings?.includes(warning) ?? false;

  const toggle = async () => {
    const existingDismissedWarnings = experiment.dismissedWarnings ?? [];
    await apiCall(`/experiment/${experiment.id}`, {
      method: "POST",
      body: JSON.stringify({
        dismissedWarnings: isMuted
          ? existingDismissedWarnings.filter((w) => w !== warning)
          : [...existingDismissedWarnings, warning],
      }),
    });
    // Ensure the experiment is refetched to get the updated dismissedWarnings
    mutate(`${orgId}::/experiment/${experiment.id}`);
  };

  return { isMuted, toggle };
}

export function MuteAlertButton({ onClick }: { onClick: () => Promise<void> }) {
  return (
    <Tooltip content="Mute this alert">
      <Button onClick={onClick} variant="ghost">
        <PiX />
      </Button>
    </Tooltip>
  );
}

export function MutedAlertNote({ onUnmute }: { onUnmute: () => void }) {
  return (
    <Text as="p" color="text-mid">
      <PiInfo /> This alert was muted, it will not consider the experiment
      Unhealthy even if problems are detected. Click{" "}
      <Link onClick={onUnmute}>here</Link> to re-enable it.
    </Text>
  );
}

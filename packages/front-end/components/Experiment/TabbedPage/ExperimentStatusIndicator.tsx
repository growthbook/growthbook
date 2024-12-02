import {
  PiConfetti,
  PiEyes,
  PiFileDashed,
  PiPlayCircleFill,
  PiSpinnerGap,
  PiSquare,
} from "react-icons/pi";
import { ExperimentStatus } from "back-end/types/experiment";
import Badge from "@/components/Radix/Badge";

export interface Props {
  status: ExperimentStatus;
  subStatus?: string;
}

function getLabel(status: ExperimentStatus, subStatus: string) {
  switch (status) {
    case "draft":
      return "Draft";
    case "running":
      return "Running";
    case "stopped":
      switch (subStatus) {
        case "won":
          return "Won";
        case "lost":
          return "Lost";
        case "dnf":
          return "Didn't Finish";
        case "inconclusive":
          return "Inconclusive";
        default:
          return "Stopped";
      }
  }
}

function getIcon(status: ExperimentStatus, subStatus: string) {
  switch (status) {
    case "draft":
      return <PiFileDashed />;
    case "running":
      return <PiPlayCircleFill />;
    case "stopped":
      switch (subStatus) {
        case "won":
          return <PiConfetti />;
        case "lost":
          return <PiEyes />;
        case "dnf":
          return <PiSpinnerGap />;
        case "inconclusive":
          return <PiEyes />;
        default:
          return <PiSquare />;
      }
  }
}

function getColorAndVariant(status: ExperimentStatus, subStatus: string) {
  switch (status) {
    case "draft":
      return ["indigo", "soft"] as const;
    case "running":
      return ["indigo", "solid"] as const;
    case "stopped":
      switch (subStatus) {
        case "won":
          return ["gray", "soft"] as const;
        case "lost":
          return ["gray", "soft"] as const;
        case "dnf":
          return ["amber", "soft"] as const;
        case "inconclusive":
          return ["gray", "solid"] as const;
        default:
          return ["red", "solid"] as const;
      }
  }
}

// TODO: Add support to Bandits exploratory stage?
export default function ExperimentStatusIndicator({
  status,
  subStatus,
}: Props) {
  const formattedLabel = getLabel(status, subStatus ?? "");
  const icon = getIcon(status, subStatus ?? "");
  const [color, variant] = getColorAndVariant(status, subStatus ?? "");

  return (
    <Badge
      color={color}
      variant={variant}
      icon={icon}
      radius="full"
      label={formattedLabel}
    />
  );
}

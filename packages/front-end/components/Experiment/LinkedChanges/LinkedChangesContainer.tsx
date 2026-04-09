import { FaPlusCircle } from "react-icons/fa";
import { ExperimentStatus } from "shared/types/experiment";
import { Box } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
import {
  ICON_PROPERTIES,
  LINKED_CHANGE_CONTAINER_PROPERTIES,
  LinkedChange,
} from "./constants";

export interface Props {
  type: LinkedChange;
  canAddChanges: boolean;
  children: JSX.Element | null;
  changeCount: number;
  experimentStatus: ExperimentStatus;
  onAddChange: () => void;
}

export default function LinkedChangesContainer({
  type,
  canAddChanges,
  children,
  changeCount,
  experimentStatus,
  onAddChange,
}: Props) {
  // Don't display linked changes section if none have been added and experiment is no longer a draft
  if ((experimentStatus !== "draft" && changeCount === 0) || changeCount === 0)
    return null;

  return (
    <Box className="appbox" px="5" py="4">
      <Box mb="2" mx="1" mt="2">
        <Heading as="h4" size="small">
          Values
        </Heading>
      </Box>
      {children}
    </Box>
  );
}

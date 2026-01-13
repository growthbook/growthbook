import { BiShow } from "react-icons/bi";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";

interface SavedGroupReferencesProps {
  totalReferences: number;
  onShowReferences: () => void;
}

export default function SavedGroupReferences({
  totalReferences,
  onShowReferences,
}: SavedGroupReferencesProps) {
  return (
    <Tooltip
      content="Currently, no active features, experiments, or saved groups reference this Saved Group."
      enabled={totalReferences === 0}
    >
      <Button
        variant="ghost"
        disabled={totalReferences === 0}
        onClick={onShowReferences}
      >
        <BiShow /> {totalReferences} reference{totalReferences !== 1 && "s"}
      </Button>
    </Tooltip>
  );
}

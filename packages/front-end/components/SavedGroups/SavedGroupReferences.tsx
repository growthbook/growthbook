import { BiShow } from "react-icons/bi";
import Link from "@/ui/Link";
import Tooltip from "@/ui/Tooltip";

interface SavedGroupReferencesProps {
  totalReferences: number;
  onShowReferences: () => void;
  isScopedToProject?: boolean;
}

export default function SavedGroupReferences({
  totalReferences,
  onShowReferences,
  isScopedToProject = false,
}: SavedGroupReferencesProps) {
  if (totalReferences === 0) {
    return (
      <Tooltip content="Currently, no active features, experiments, or saved groups reference this Saved Group.">
        <span style={{ color: "var(--gray-10)", cursor: "not-allowed" }}>
          <BiShow /> {totalReferences} references
          {isScopedToProject && " in this project"}
        </span>
      </Tooltip>
    );
  }

  return (
    <Link onClick={onShowReferences}>
        <BiShow /> {totalReferences} reference{totalReferences !== 1 && "s"}
      {isScopedToProject && " in this project"}
    </Link>
  );
}

import { VisualChangesetInterface } from "back-end/types/visual-changeset";
import usePermissions from "@/hooks/usePermissions";
import OpenVisualEditorLink from "../OpenVisualEditorLink";

export default function VisualChanges({
  changeIndex,
  visualChangeset,
}: {
  changeIndex: number;
  visualChangeset: VisualChangesetInterface;
}) {
  const permissions = usePermissions();
  const isControl = changeIndex === 0;
  const visualChanges = visualChangeset.visualChanges[changeIndex];
  const changeCount =
    visualChanges.domMutations.length + (visualChanges.css ? 1 : 0);

  if (permissions.check("createAnalyses", "")) {
    return isControl ? null : (
      <div className="my-2">
        <OpenVisualEditorLink
          id={visualChangeset.id}
          changeIndex={changeIndex}
          visualEditorUrl={visualChangeset.editorUrl}
        />
        <div style={{ fontSize: "0.75rem" }}>{changeCount} changes</div>
      </div>
    );
  }
}

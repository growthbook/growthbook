import { useEffect, useRef, useState } from "react";
import HelperText from "@/ui/HelperText";
import { ApiCallError } from "@/services/apiCallError";
import {
  StagedChange,
  StagedChangesPopover,
} from "@/components/StagedEdits/StagedChanges";
import { incompatibleNote, useExperimentEdits } from "./ExperimentEdits";

type SaveCheck = { status: "ready" } | { status: "refused"; reason: string };

/** The save bar's list of staged edits, what each changes, and whether they'd save. */
export default function StagedChanges() {
  const edits = useExperimentEdits();
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState<SaveCheck | null>(null);
  const staged = edits?.staged;
  const conflicts = edits?.conflicts;
  const incompatible = edits?.incompatible;
  // A save refused over someone else's change, or a status change that left
  // edits behind, opens the list to resolve it.
  useEffect(() => {
    if (conflicts?.length || incompatible?.length) setOpen(true);
  }, [conflicts, incompatible]);

  // The check runs when the list opens or changes, not when the page renders.
  const checkAll = useRef(edits?.checkAll);
  checkAll.current = edits?.checkAll;
  useEffect(() => {
    setCheck(null);
    // Not while edits left behind still block the save.
    if (!open || !checkAll.current || incompatible?.length) return;
    let current = true;
    checkAll
      .current()
      .then(() => {
        // Not while an edit still conflicts.
        if (current && !conflicts?.length) setCheck({ status: "ready" });
      })
      .catch((e) => {
        if (!current) return;
        // Each conflicting edit says so on its own row.
        if (e instanceof ApiCallError && e.code === "changes_conflict") {
          setCheck(null);
          return;
        }
        setCheck({
          status: "refused",
          reason: e.message || "The save would be refused.",
        });
      });
    return () => {
      current = false;
    };
  }, [open, staged, conflicts, incompatible]);

  if (!edits || !staged) return null;

  return (
    <StagedChangesPopover
      open={open}
      onOpenChange={setOpen}
      count={staged.length}
    >
      {edits.incompatible.length ? (
        <HelperText status="warning" size="sm" mb="1">
          {incompatibleNote(edits.incompatible)}
        </HelperText>
      ) : null}
      {staged.map(({ id, label }) => (
        <StagedChange
          key={id}
          label={label}
          review={edits.review(id)}
          discard={() => edits.discard(id)}
          keepMine={
            edits.conflicts.includes(id) ? () => edits.keepMine(id) : null
          }
          incompatible={
            edits.incompatible.some((e) => e.id === id)
              ? "Made before the experiment's status changed."
              : null
          }
          saving={edits.saving}
        />
      ))}
      {check?.status === "ready" ? (
        <HelperText status="success" size="sm" mt="1">
          Ready to save.
        </HelperText>
      ) : check?.status === "refused" ? (
        <HelperText status="error" size="sm" mt="1">
          {check.reason}
        </HelperText>
      ) : null}
    </StagedChangesPopover>
  );
}

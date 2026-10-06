import { useState } from "react";
import { useEnvironments } from "@/services/features";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import MultiSelectField from "@/ui/MultiSelectField";

// Picks the environments a Values experiment delivers to. Prototype-only:
// the selection is stored in localStorage (see ManagedValuesContext.tsx).
//
// Deliberately NOT prototype/managed-values-simplified's
// EditEnvironmentsModal. That one is mostly approval gating (the lock banner,
// routing a save into a review request, "Requires approval" markers,
// "Save & restart review"); approvals are out of scope for this phase. This
// is the picker, nothing else.
//
// Apply hands the selection to the Setup page's draft (set in review); the
// page's save bar then saves it.
export default function EditValuesEnvironmentsModal({
  close,
  environments,
  onApply,
}: {
  close: () => void;
  // The page's current selection, saved or applied.
  environments: string[];
  onApply: (environments: string[]) => void;
}) {
  const allEnvironments = useEnvironments();
  const [selected, setSelected] = useState<string[]>(environments);
  // At least one environment (set in review): with none, Apply is disabled
  // and the field says why.
  const noneSelected = selected.length === 0;
  const changed =
    [...selected].sort().join("\n") !== [...environments].sort().join("\n");

  return (
    <ModalStandard
      open
      close={close}
      header="Edit Environments"
      trackingEventModalType=""
      cta="Apply"
      ctaEnabled={!noneSelected && changed}
      submit={() => onApply(selected)}
    >
      <MultiSelectField
        label="Environments"
        placeholder="Select environments..."
        value={selected}
        options={allEnvironments.map((env) => ({
          label: env.id,
          value: env.id,
        }))}
        onChange={setSelected}
        error={noneSelected ? "Select at least one environment." : undefined}
        sort={false}
        showCopyButton={false}
      />
    </ModalStandard>
  );
}

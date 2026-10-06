import { useState } from "react";
import { useEnvironments } from "@/services/features";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import MultiSelectField from "@/ui/MultiSelectField";
import { useExperimentType } from "@/components/Experiment/TabbedPage/ManagedValuesContext";

// Picks the environments a Values experiment delivers to. Prototype-only:
// the selection is stored in localStorage (see ManagedValuesContext.tsx).
//
// Deliberately NOT prototype/managed-values-simplified's
// EditEnvironmentsModal. That one is mostly approval gating (the lock banner,
// routing a save into a review request, "Requires approval" markers,
// "Save & restart review"); approvals are out of scope for this phase. This
// is the picker and the save, nothing else.
export default function EditValuesEnvironmentsModal({
  close,
}: {
  close: () => void;
}) {
  const allEnvironments = useEnvironments();
  const { environments, setEnvironments } = useExperimentType();
  const [selected, setSelected] = useState<string[]>(environments);
  // At least one environment (set in review): with none, Save is disabled
  // and the field says why.
  const noneSelected = selected.length === 0;

  return (
    <ModalStandard
      open
      close={close}
      header="Edit Environments"
      trackingEventModalType=""
      cta="Save"
      ctaEnabled={!noneSelected}
      submit={async () => {
        setEnvironments(selected);
      }}
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

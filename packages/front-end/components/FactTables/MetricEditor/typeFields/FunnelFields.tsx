import { FunnelSettings } from "shared/types/fact-table";
import FunnelStepsInput from "@/components/FactTables/FunnelStepsInput";

// Reuses the existing step editor unchanged (plan) - it already renders
// StepNumber/NameInput/Remove, per-step Row filters, and read-only-fact-
// table-plus-Edit for steps after the first.
export default function FunnelFields({
  value,
  onChange,
  datasource,
  project,
  initialFactTable,
}: {
  value: FunnelSettings;
  onChange: (value: FunnelSettings) => void;
  datasource: string;
  project?: string;
  initialFactTable?: string;
}) {
  return (
    <FunnelStepsInput
      value={value}
      setValue={onChange}
      datasource={datasource}
      project={project}
      initialFactTable={initialFactTable}
    />
  );
}

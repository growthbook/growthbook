import { Environment } from "back-end/types/organization";
import SelectField, {
  FormatOptionLabelType,
} from "@/components/Forms/SelectField";

export default function EnvironmentDropdown({
  label,
  env,
  setEnv,
  environments,
  formatOptionLabel,
}: {
  label?: string;
  env?: string;
  setEnv: (env: string) => void;
  environments: Environment[];
  formatOptionLabel: FormatOptionLabelType;
}) {
  return (
    <SelectField
      label={label}
      value={env || ""}
      onChange={setEnv}
      options={environments.map((e) => ({
        label: e.id,
        value: e.id,
      }))}
      formatOptionLabel={formatOptionLabel}
    />
  );
}

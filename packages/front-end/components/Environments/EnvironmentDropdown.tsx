import { Environment } from "shared/types/organization";
import SelectField, {
  FormatOptionLabelType,
} from "@/components/Forms/SelectField";

export default function EnvironmentDropdown({
  label,
  env,
  setEnv,
  environments,
  formatOptionLabel,
  placeholder,
  containerClassName,
}: {
  label?: string;
  env?: string;
  setEnv: (env: string) => void;
  environments: Environment[];
  formatOptionLabel: FormatOptionLabelType;
  placeholder?: string;
  containerClassName?: string;
}) {
  return (
    <SelectField
      containerClassName={containerClassName}
      label={label}
      value={env || ""}
      onChange={setEnv}
      options={[
        {
          label: "Type to search",
          options: environments.map((e) => ({
            label: e.id,
            value: e.id,
          })),
        },
      ]}
      formatOptionLabel={formatOptionLabel}
      placeholder={placeholder}
      forceUndefinedValueToNull
    />
  );
}

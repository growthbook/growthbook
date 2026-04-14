import { useMemo } from "react";
import Owner from "@/components/Avatar/Owner";
import SelectField from "@/components/Forms/SelectField";
import { useUser } from "@/services/UserContext";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function SelectOwner({
  value,
  onChange,
  placeholder = "",
  disabled = false,
}: Props) {
  const { users } = useUser();

  const memberOptions = useMemo(() => {
    return Array.from(users.values()).map((user) => ({
      value: user.id,
      label: user.name || user.email,
    }));
  }, [users]);

  const memberOptionValues = useMemo(() => {
    return new Set(memberOptions.map((member) => member.value));
  }, [memberOptions]);

  const options = useMemo(() => {
    if (!value || memberOptionValues.has(value)) {
      return memberOptions;
    }

    // Keep showing legacy owner values (username/email) until user chooses a new owner.
    return [{ value, label: value }, ...memberOptions];
  }, [memberOptions, memberOptionValues, value]);

  return (
    <SelectField
      label="Owner"
      options={options}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={onChange}
      formatOptionLabel={(option) => (
        <Owner
          ownerId={option.value}
          gap="1"
          textColor="text-mid"
          weight="regular"
        />
      )}
    />
  );
}

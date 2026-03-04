import { useMemo } from "react";
import Text from "@/ui/Text";
import UserAvatar from "@/components/Avatar/UserAvatar";
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
      label: user.name ? user.name : user.email,
    }));
  }, [users]);

  const options = useMemo(() => {
    if (!value || memberOptions.some((member) => member.value === value)) {
      return memberOptions;
    }

    // Keep showing legacy owner values (username/email) until user chooses a new owner.
    return [{ value, label: value }, ...memberOptions];
  }, [memberOptions, value]);

  return (
    <SelectField
      label="Owner"
      options={options}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={onChange}
      formatOptionLabel={({ label }) => {
        return (
          <>
            <span>
              {label !== "" && (
                <UserAvatar name={label} size="sm" variant="soft" />
              )}
              <Text weight="regular" color="text-mid" ml="1">
                {label === "" ? "None" : label}
              </Text>
            </span>
          </>
        );
      }}
    />
  );
}

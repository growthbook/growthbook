import { useMemo } from "react";
import Text from "@/ui/Text";
import UserAvatar from "@/components/Avatar/UserAvatar";
import SelectField from "@/components/Forms/SelectField";
import { useUser } from "@/services/UserContext";
import { getDisplayNameForUser } from "@/services/owners";

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
  const { users, settings } = useUser();

  const memberOptions = useMemo(() => {
    return Array.from(users.values()).map((user) => ({
      value: user.id,
      label: getDisplayNameForUser(user, settings.userNameDisplayFormat),
    }));
  }, [settings.userNameDisplayFormat, users]);

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

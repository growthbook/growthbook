import { useMemo } from "react";
import { Text } from "@radix-ui/themes";
import metaDataStyles from "@/ui/Metadata.module.scss";
import UserAvatar from "@/components/Avatar/UserAvatar";
import SelectField from "@/components/Forms/SelectField";
import { useUser } from "@/services/UserContext";

interface Props {
  value: string;
  onChange: (v: string) => void;
  resourceType:
    | "dimension"
    | "feature"
    | "experiment"
    | "segment"
    | "factSegment"
    | "savedGroup"
    | "metric"
    | "factMetric"
    | "archetype"
    | "factTable"
    | "dashboard";
  placeholder?: string;
  disabled?: boolean;
}

export default function SelectOwner({
  value,
  onChange,
  placeholder = "",
  resourceType: _resourceType,
  disabled = false,
}: Props) {
  const { users } = useUser();

  const activeUsers = useMemo(() => {
    return Array.from(users.values());
  }, [users]);

  const memberOptions = useMemo(() => {
    return activeUsers.map((user) => ({
      value: user.id,
      label: user.name ? user.name : user.email,
    }));
  }, [activeUsers]);

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
      options={options.map(({ value, label }) => ({ value, label }))}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(v) => onChange(v)}
      formatOptionLabel={({ label }) => {
        return (
          <>
            <span>
              {label !== "" && (
                <UserAvatar name={label} size="sm" variant="soft" />
              )}
              <Text
                weight="regular"
                className={metaDataStyles.valueColor}
                ml="1"
              >
                {label === "" ? "None" : label}
              </Text>
            </span>
          </>
        );
      }}
    />
  );
}

import useMembers from "@/hooks/useMembers";
import metaDataStyles from "@/ui/Metadata.module.scss";
import UserAvatar from "@/components/Avatar/UserAvatar";
import SelectField from "@/components/Forms/SelectField";
import Text from "@/ui/Text";

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
  resourceType,
  disabled = false,
}: Props) {
  const { memberUsernameOptions, memberUserNameAndIdOptions } = useMembers();

  // Some resources store the owner by name and some by id, so check which one it is
  const ownerIdentifierType = [
    "experiment",
    "experimentTemplate",
    "factTable",
    "archetype",
    "dashboard",
  ].includes(resourceType)
    ? "id"
    : "name";

  // if the resource stores owner by id, we need the id to be the value, rather than the name
  const memberOptions =
    ownerIdentifierType === "id"
      ? memberUserNameAndIdOptions
      : memberUsernameOptions;

  return (
    <SelectField
      label="Owner"
      options={memberOptions.map((member) => ({
        value: member.value,
        label: member.display,
      }))}
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

import { ReactNode, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiPencilSimple } from "react-icons/pi";
import Text from "@/ui/Text";
import { useEnvironments } from "@/services/features";
import MultiSelectField from "@/ui/MultiSelectField";

const ALL_ENVIRONMENTS = "__all_environments__";

// Reads as text until the pencil opens the picker. Null means every environment.
export default function EnvironmentScopeCell({
  environments,
  onChange,
  noneLabel = null,
}: {
  environments: string[] | null;
  onChange?: (environments: string[] | null) => void;
  // Shown when limited to no environments at all.
  noneLabel?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const envOptions = useEnvironments().map((e) => ({
    label: e.id,
    value: e.id,
  }));

  if (!editing) {
    return (
      <Flex align="center" gap="2" minHeight={onChange ? "32px" : undefined}>
        {environments === null ? (
          <Text>All Environments</Text>
        ) : environments.length ? (
          <Text>{environments.join(", ")}</Text>
        ) : (
          noneLabel
        )}
        {onChange && (
          <IconButton
            variant="ghost"
            radius="full"
            size="1"
            onClick={() => setEditing(true)}
            aria-label="Edit environments"
          >
            <PiPencilSimple />
          </IconButton>
        )}
      </Flex>
    );
  }

  return (
    <Box>
      <MultiSelectField
        aria-label="Environments"
        containerClassName="mb-0"
        showCopyButton={false}
        value={environments ?? [ALL_ENVIRONMENTS]}
        options={[
          { label: "All Environments", value: ALL_ENVIRONMENTS },
          ...envOptions,
        ]}
        onChange={(next) =>
          onChange?.(
            next.includes(ALL_ENVIRONMENTS) && environments !== null
              ? null
              : next.filter((e) => e !== ALL_ENVIRONMENTS),
          )
        }
        sort={false}
        formatOptionLabel={(option) =>
          option.value === ALL_ENVIRONMENTS ? (
            <em>{option.label}</em>
          ) : (
            option.label
          )
        }
        placeholder="No environments"
        autoFocus
      />
    </Box>
  );
}

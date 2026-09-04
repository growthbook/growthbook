import { Flex, type AvatarProps } from "@radix-ui/themes";
import { ImplementationType } from "shared/validators";
import { SELECTABLE_IMPLEMENTATION_TYPES } from "shared/util";
import { PiChartBar, PiDesktop, PiFlag, PiLink, PiTag } from "react-icons/pi";
import Avatar from "@/ui/Avatar";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import { ICON_PROPERTIES } from "@/components/Experiment/LinkedChanges/constants";

type Option = {
  header: string;
  description: string;
  icon: React.ReactElement;
  color: AvatarProps["color"];
};

export const IMPLEMENTATION_TYPE_OPTIONS: Record<ImplementationType, Option> = {
  values: {
    header: "Values",
    description: "Set a value per variation",
    icon: <PiTag />,
    color: "violet",
  },
  visual: {
    header: "Visual Editor",
    description: "No-code browser extension",
    icon: <PiDesktop />,
    color: ICON_PROPERTIES["visual-editor"].radixColor,
  },
  urlredirect: {
    header: "URL Redirect",
    description: "A/B test URL redirects",
    icon: <PiLink />,
    color: ICON_PROPERTIES.redirects.radixColor,
  },
  feature: {
    header: "Feature Flag",
    description: "Make code changes in your app",
    icon: <PiFlag />,
    color: ICON_PROPERTIES["feature-flag"].radixColor,
  },
  none: {
    header: "None",
    description: "Analysis only, nothing to implement",
    icon: <PiChartBar />,
    color: "gray",
  },
  multi: {
    header: "Multiple",
    description: "More than one kind of implementation",
    icon: <PiChartBar />,
    color: "gray",
  },
};

export function ImplementationTypeLabel({
  type,
  compact,
}: {
  type: ImplementationType;
  compact?: boolean;
}) {
  const option = IMPLEMENTATION_TYPE_OPTIONS[type];
  if (compact) {
    return (
      <Flex align="center" gap="2">
        <span style={{ color: `var(--${option.color}-9)`, display: "flex" }}>
          {option.icon}
        </span>
        <Text>{option.header}</Text>
      </Flex>
    );
  }
  return (
    <Flex align="center" gap="2" py="1">
      <Avatar radius="small" color={option.color} size="sm" variant="soft">
        {option.icon}
      </Avatar>
      <Flex direction="column">
        <Text weight="semibold">{option.header}</Text>
        <Text color="text-mid">{option.description}</Text>
      </Flex>
    </Flex>
  );
}

export default function ImplementationTypeSelect({
  value,
  setValue,
  label = "Implementation",
  disabled,
  lockedReason,
}: {
  value: ImplementationType | undefined;
  setValue: (value: ImplementationType) => void;
  label?: string;
  disabled?: boolean;
  lockedReason?: string;
}) {
  const select = (
    <SelectField
      label={label}
      value={value ?? ""}
      onChange={(v) => setValue(v as ImplementationType)}
      // The current value stays visible even when it is not offered.
      options={[
        ...SELECTABLE_IMPLEMENTATION_TYPES,
        ...(value && !SELECTABLE_IMPLEMENTATION_TYPES.includes(value)
          ? [value]
          : []),
      ].map((type) => ({
        value: type,
        label: IMPLEMENTATION_TYPE_OPTIONS[type].header,
      }))}
      isOptionDisabled={(o) =>
        !SELECTABLE_IMPLEMENTATION_TYPES.includes(
          (o as { value: string }).value as ImplementationType,
        )
      }
      formatOptionLabel={(option, { context }) => (
        <ImplementationTypeLabel
          type={option.value as ImplementationType}
          compact={context === "value"}
        />
      )}
      isSearchable={false}
      sort={false}
      disabled={disabled}
      placeholder="Choose how this experiment reaches users"
    />
  );
  return disabled && lockedReason ? (
    <Tooltip body={lockedReason}>{select}</Tooltip>
  ) : (
    select
  );
}

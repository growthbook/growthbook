import { Flex, type AvatarProps } from "@radix-ui/themes";
import { ImplementationType } from "shared/validators";
import { SELECTABLE_IMPLEMENTATION_TYPES } from "shared/util";
import { PiChartBar, PiTag } from "react-icons/pi";
import Avatar from "@/ui/Avatar";
import Text from "@/ui/Text";
import { Select, SelectItem } from "@/ui/Select";
import Tooltip from "@/components/Tooltip/Tooltip";
import { ICON_PROPERTIES } from "@/components/Experiment/LinkedChanges/constants";

const FlagIcon = ICON_PROPERTIES["feature-flag"].component;
const VisualIcon = ICON_PROPERTIES["visual-editor"].component;
const RedirectIcon = ICON_PROPERTIES.redirects.component;

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
    icon: <VisualIcon />,
    color: ICON_PROPERTIES["visual-editor"].radixColor,
  },
  urlredirect: {
    header: "URL Redirect",
    description: "A/B test URL redirects",
    icon: <RedirectIcon />,
    color: ICON_PROPERTIES.redirects.radixColor,
  },
  feature: {
    header: "Feature Flag",
    description: "Make code changes in your app",
    icon: <FlagIcon />,
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
  return (
    <Flex align="center" gap="2" py={compact ? "0" : "1"}>
      <Avatar radius="small" color={option.color} size="sm" variant="soft">
        {option.icon}
      </Avatar>
      <Flex direction="column">
        <Text weight={compact ? "regular" : "semibold"}>{option.header}</Text>
        {!compact && <Text color="text-mid">{option.description}</Text>}
      </Flex>
    </Flex>
  );
}

// Free to change until something is wired up; the caller says why it is not.
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
    <Select
      label={label}
      value={value}
      setValue={(v) => setValue(v as ImplementationType)}
      disabled={disabled}
      placeholder="Choose how this experiment reaches users"
    >
      {SELECTABLE_IMPLEMENTATION_TYPES.map((type) => (
        <SelectItem key={type} value={type}>
          <ImplementationTypeLabel type={type} />
        </SelectItem>
      ))}
    </Select>
  );
  return disabled && lockedReason ? (
    <Tooltip body={lockedReason}>{select}</Tooltip>
  ) : (
    select
  );
}

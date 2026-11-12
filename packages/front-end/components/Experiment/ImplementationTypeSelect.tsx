import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import { Flex, type AvatarProps } from "@radix-ui/themes";
import type { UseFormReturn } from "react-hook-form";
import {
  ExperimentType,
  ImplementationType,
  SelectableImplementationType,
} from "shared/validators";
import type { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { SELECTABLE_IMPLEMENTATION_TYPES } from "shared/util";
import { getScopedSettings } from "shared/settings";
import { DEFAULT_EXPERIMENT_IMPLEMENTATION } from "shared/constants";
import { NO_ENVIRONMENT_BINDING } from "shared/permissions";
import { PiChartBar, PiDesktop, PiFlag, PiLink, PiTag } from "react-icons/pi";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Avatar from "@/ui/Avatar";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import { ICON_PROPERTIES } from "@/components/Experiment/LinkedChanges/constants";

type Option = {
  header: string;
  // Of what it implements: "experiment" or "Bandit".
  description: (noun: string) => string;
  icon: React.ReactElement;
  color: AvatarProps["color"];
};

export const IMPLEMENTATION_TYPE_OPTIONS: Record<ImplementationType, Option> = {
  values: {
    header: "Values",
    description: (noun) => `A Feature Flag managed by this ${noun}`,
    icon: <PiTag />,
    color: "violet",
  },
  visual: {
    header: "AI Visual Editor",
    description: () => "No-code browser extension",
    icon: <PiDesktop />,
    color: ICON_PROPERTIES["visual-editor"].radixColor,
  },
  urlredirect: {
    header: "URL Redirect",
    description: () => "Test standalone pages without a Feature Flag",
    icon: <PiLink />,
    color: ICON_PROPERTIES.redirects.radixColor,
  },
  feature: {
    header: "Feature Flag",
    description: () => "Make code changes in your app",
    icon: <PiFlag />,
    color: ICON_PROPERTIES["feature-flag"].radixColor,
  },
  none: {
    header: "None",
    description: (noun) => `Can be chosen later before ${noun} start`,
    icon: <PiChartBar />,
    color: "gray",
  },
  multi: {
    header: "Multiple",
    description: () =>
      "Combine Feature Flags, AI Visual Editor changes and URL Redirects",
    icon: <PiChartBar />,
    color: "gray",
  },
};

export function implementationNoun(type: ExperimentType | undefined) {
  return type === "multi-armed-bandit" ? "Bandit" : "experiment";
}

export const LIST_ICON_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  marginLeft: "var(--space-2)",
};

/** The bare icon with the picker's wording as its tooltip, for list rows. */
export function ImplementationTypeIcon({
  type,
  title,
  description,
  noun = "experiment",
  style,
}: {
  type: ImplementationType;
  /** Override for surfaces that read from the other side, e.g. a flag's row. */
  title?: string;
  description?: string;
  noun?: string;
  style?: CSSProperties;
}) {
  const option = IMPLEMENTATION_TYPE_OPTIONS[type];
  return (
    <Tooltip
      flipTheme={false}
      style={style}
      body={
        <>
          <div>{title ?? `${option.header} implementation`}</div>
          <Text size="sm" color="text-mid">
            {description ?? option.description(noun)}
          </Text>
        </>
      }
    >
      <span
        role="img"
        aria-label={title ?? option.header}
        style={{ display: "flex", color: "var(--color-text-mid)" }}
      >
        {option.icon}
      </span>
    </Tooltip>
  );
}

function ImplementationTypeLabel({
  type,
  noun,
  compact,
}: {
  type: ImplementationType;
  noun: string;
  compact?: boolean;
}) {
  const option = IMPLEMENTATION_TYPE_OPTIONS[type];
  // Not a kind of implementation, so it reads as the absence of one.
  if (type === "none") {
    if (compact) return <Text>{option.header}</Text>;
    // No icon, but lined up with the other options' names past theirs.
    return (
      <Flex
        direction="column"
        py="1"
        pl="calc(var(--space-5) + var(--space-2))"
      >
        <Text weight="semibold">{option.header}</Text>
        <Text color="text-mid">{option.description(noun)}</Text>
      </Flex>
    );
  }
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
        <Text color="text-mid">{option.description(noun)}</Text>
      </Flex>
    </Flex>
  );
}

/**
 * What a new experiment in this Project starts as: the Project's setting, else
 * the organization's. Values gives way to none where its flag can't be created.
 */
function useDefaultImplementationType(projectId: string): ImplementationType {
  const { organization } = useUser();
  const { getProjectById } = useDefinitions();
  const { requireProjectForFeatures } = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();
  const type =
    getScopedSettings({
      organization,
      project: getProjectById(projectId) ?? undefined,
    }).settings.defaultExperimentImplementation.value ??
    DEFAULT_EXPERIMENT_IMPLEMENTATION;
  const valuesBlocked =
    !permissionsUtil.canCreateFeature(
      { project: projectId },
      NO_ENVIRONMENT_BINDING,
    ) ||
    (!!requireProjectForFeatures && !projectId);
  return type === "values" && valuesBlocked ? "none" : type;
}

/**
 * Keeps a create form's implementation type on its Project's default until
 * someone picks one; returns the setter for that pick.
 */
export function useImplementationTypeField(
  form: UseFormReturn<Partial<ExperimentInterfaceStringDates>>,
  enabled = true,
): (value: ImplementationType | undefined) => void {
  const fallback = useDefaultImplementationType(form.watch("project") ?? "");
  const picked = useRef(false);
  useEffect(() => {
    if (enabled && !picked.current) {
      form.setValue("implementationType", fallback);
    }
  }, [enabled, fallback, form]);
  return (value) => {
    picked.current = true;
    form.setValue("implementationType", value);
  };
}

export default function ImplementationTypeSelect({
  value,
  setValue,
  noun = "experiment",
  label = "Implementation",
  inherited,
}: {
  value: ImplementationType | undefined;
  // Only what it offers can be picked.
  setValue: (value: SelectableImplementationType | undefined) => void;
  noun?: string;
  label?: ReactNode;
  // Where it can follow a parent setting: what that is, offered as the empty
  // choice.
  inherited?: ImplementationType;
}) {
  return (
    <SelectField
      label={label}
      value={value ?? ""}
      onChange={(v) =>
        setValue((v || undefined) as SelectableImplementationType | undefined)
      }
      // The current value stays visible even when it is not offered.
      options={[
        ...(inherited
          ? [
              {
                value: "",
                label: `Organization default (${IMPLEMENTATION_TYPE_OPTIONS[inherited].header})`,
              },
            ]
          : []),
        ...[
          ...SELECTABLE_IMPLEMENTATION_TYPES,
          ...(value && !SELECTABLE_IMPLEMENTATION_TYPES.includes(value)
            ? [value]
            : []),
        ].map((type) => ({
          value: type,
          label: IMPLEMENTATION_TYPE_OPTIONS[type].header,
          isDisabled: !SELECTABLE_IMPLEMENTATION_TYPES.includes(type),
        })),
      ]}
      formatOptionLabel={(option, { context }) =>
        option.value ? (
          <ImplementationTypeLabel
            type={option.value as ImplementationType}
            noun={noun}
            compact={context === "value"}
          />
        ) : (
          <Text>{option.label}</Text>
        )
      }
      isSearchable={false}
      sort={false}
      // Every option at once: it opens upward rather than scroll when there
      // isn't room below for all five.
      maxMenuHeight={400}
      minMenuHeight={340}
      placeholder={`Choose how this ${noun} reaches users`}
    />
  );
}

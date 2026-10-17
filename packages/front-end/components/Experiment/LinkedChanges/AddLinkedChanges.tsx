import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { CommercialFeature } from "shared/enterprise";
import {
  SDKCapability,
  getConnectionsSDKCapabilities,
} from "shared/sdk-versioning";
import { ReactElement } from "react";
import { Flex, type AvatarProps } from "@radix-ui/themes";
import { PiCaretDownFill, PiDesktop, PiFlag, PiLink } from "react-icons/pi";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Avatar from "@/ui/Avatar";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";
import { ICON_PROPERTIES } from "./constants";

// What adding each no-code kind needs: an SDK that applies it, and the plan
// feature that lets the experiment start. A Feature Flag needs neither.
const ADD_GATES = {
  visual: {
    header: "AI Visual Editor",
    commercialFeature: "visual-editor",
    sdkCapabilityKey: "visualEditor",
  },
  urlredirect: {
    header: "URL Redirects",
    commercialFeature: "redirects",
    sdkCapabilityKey: "redirects",
  },
} as const satisfies Record<
  string,
  {
    header: string;
    commercialFeature: CommercialFeature;
    sdkCapabilityKey: SDKCapability;
  }
>;

type AddableKind = "feature" | keyof typeof ADD_GATES;

const ADD_OPTIONS: Record<
  AddableKind,
  {
    header: string;
    description: string;
    icon: ReactElement;
    color: AvatarProps["color"];
  }
> = {
  feature: {
    header: "Feature Flag",
    description: "Make code changes in your app",
    icon: <PiFlag />,
    color: ICON_PROPERTIES["feature-flag"].radixColor,
  },
  visual: {
    header: "AI Visual Editor",
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
};

/** Why this kind can't be added yet, and the plan feature starting it needs. */
export function useLinkedChangeAddGate(
  type: AddableKind,
  experiment: ExperimentInterfaceStringDates,
): {
  unsupportedReason: string | null;
  commercialFeature: CommercialFeature | null;
} {
  const { data: sdkConnectionsData } = useSDKConnections();
  if (type === "feature") {
    return { unsupportedReason: null, commercialFeature: null };
  }
  const { header, commercialFeature, sdkCapabilityKey } = ADD_GATES[type];
  const hasSDKWithFeature = getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections ?? [],
    project: experiment.project ?? "",
  }).includes(sdkCapabilityKey);
  return {
    unsupportedReason: hasSDKWithFeature
      ? null
      : `The SDKs in this project don't support ${header}. Upgrade your SDK(s) or add a supported SDK.`,
    commercialFeature,
  };
}

function AddImplementationItem({
  type,
  experiment,
  onClick,
  blockedReason,
}: {
  type: AddableKind;
  experiment: ExperimentInterfaceStringDates;
  onClick: () => void;
  blockedReason?: string | null;
}) {
  const { hasCommercialFeature } = useUser();
  const { unsupportedReason, commercialFeature } = useLinkedChangeAddGate(
    type,
    experiment,
  );
  const disabledReason = blockedReason ?? unsupportedReason;
  const option = ADD_OPTIONS[type];
  const color = disabledReason ? "text-disabled" : "text-high";
  const content = (
    <Flex align="center" gap="2" p="3">
      <Avatar radius="small" color={option.color} size="sm" variant="soft">
        {option.icon}
      </Avatar>
      <Flex direction="column">
        <Text color={color} weight="semibold">
          {option.header}
        </Text>
        <Text color={color}>{option.description}</Text>
      </Flex>
    </Flex>
  );
  return (
    <DropdownMenuItem
      onClick={onClick}
      disabled={!!disabledReason}
      style={{ padding: 0, height: "auto" }}
    >
      {disabledReason ? (
        <Tooltip content={disabledReason} side="left">
          <span>{content}</span>
        </Tooltip>
      ) : commercialFeature && !hasCommercialFeature(commercialFeature) ? (
        <PremiumTooltip
          commercialFeature={commercialFeature}
          body="You can add this to your draft, but you will not be able to start the experiment until upgrading."
          tipPosition="left"
        >
          {content}
        </PremiumTooltip>
      ) : (
        content
      )}
    </DropdownMenuItem>
  );
}

/** Adds a kind the experiment doesn't have yet; each kind it has adds under its own section. */
export function AddImplementationMenu({
  experiment,
  onFeatureFlag,
  onVisualEditor,
  onUrlRedirect,
  blockedReasons = {},
}: {
  experiment: ExperimentInterfaceStringDates;
  // Absent for a kind the menu doesn't offer.
  onFeatureFlag: (() => void) | null;
  onVisualEditor: (() => void) | null;
  onUrlRedirect: (() => void) | null;
  // Why a kind can't be added right now.
  blockedReasons?: Partial<Record<AddableKind, string | null>>;
}) {
  return (
    <DropdownMenu
      trigger={
        <Button
          variant="outline"
          icon={<PiCaretDownFill />}
          iconPosition="right"
        >
          Add implementation
        </Button>
      }
      menuPlacement="end"
      variant="soft"
    >
      {onFeatureFlag ? (
        <AddImplementationItem
          type="feature"
          experiment={experiment}
          onClick={onFeatureFlag}
          blockedReason={blockedReasons.feature}
        />
      ) : null}
      {onVisualEditor ? (
        <AddImplementationItem
          type="visual"
          experiment={experiment}
          onClick={onVisualEditor}
          blockedReason={blockedReasons.visual}
        />
      ) : null}
      {onUrlRedirect ? (
        <AddImplementationItem
          type="urlredirect"
          experiment={experiment}
          onClick={onUrlRedirect}
          blockedReason={blockedReasons.urlredirect}
        />
      ) : null}
    </DropdownMenu>
  );
}

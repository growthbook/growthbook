import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { CommercialFeature } from "shared/enterprise";
import {
  SDKCapability,
  getConnectionsSDKCapabilities,
} from "shared/sdk-versioning";
import { ReactElement } from "react";
import { Flex, type AvatarProps } from "@radix-ui/themes";
import {
  PiCaretDownFill,
  PiDesktop,
  PiFlag,
  PiLink,
  PiPlus,
} from "react-icons/pi";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Avatar from "@/ui/Avatar";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import SplitButton from "@/ui/SplitButton";
import Tooltip from "@/ui/Tooltip";
import { ICON_PROPERTIES } from "./constants";

type AddableKind = "feature" | "visual" | "urlredirect";
export const ADDABLE_KINDS: AddableKind[] = [
  "feature",
  "visual",
  "urlredirect",
];

const ADD_OPTIONS: Record<
  AddableKind,
  {
    header: string;
    description: string;
    addLabel: string;
    icon: ReactElement;
    color: AvatarProps["color"];
    // What adding a no-code kind needs: an SDK that applies it, and the plan
    // feature that lets the experiment start. A Feature Flag needs neither.
    gate: {
      name: string;
      commercialFeature: CommercialFeature;
      sdkCapabilityKey: SDKCapability;
    } | null;
  }
> = {
  feature: {
    header: "Feature Flag",
    description: "Make code changes in your app",
    addLabel: "Add Feature Flag",
    icon: <PiFlag />,
    color: ICON_PROPERTIES["feature-flag"].radixColor,
    gate: null,
  },
  visual: {
    header: "AI Visual Editor",
    description: "No-code browser extension",
    addLabel: "Add AI Visual Editor changes",
    icon: <PiDesktop />,
    color: ICON_PROPERTIES["visual-editor"].radixColor,
    gate: {
      name: "AI Visual Editor",
      commercialFeature: "visual-editor",
      sdkCapabilityKey: "visualEditor",
    },
  },
  urlredirect: {
    header: "URL Redirect",
    description: "A/B test URL redirects",
    addLabel: "Add URL redirect",
    icon: <PiLink />,
    color: ICON_PROPERTIES.redirects.radixColor,
    gate: {
      name: "URL Redirects",
      commercialFeature: "redirects",
      sdkCapabilityKey: "redirects",
    },
  },
};

const PREMIUM_BODY =
  "You can add this to your draft, but you will not be able to start the experiment until upgrading.";

// Why this kind can't be added now, or the plan feature it lacks to start.
function useLinkedChangeAddGate(
  type: AddableKind,
  experiment: ExperimentInterfaceStringDates,
  blockedReason: string | null | undefined,
): {
  disabledReason: string | null;
  missingFeature: CommercialFeature | null;
} {
  const { data: sdkConnectionsData } = useSDKConnections();
  const { hasCommercialFeature } = useUser();
  const { gate } = ADD_OPTIONS[type];
  if (!gate) {
    return { disabledReason: blockedReason ?? null, missingFeature: null };
  }
  const hasSDKWithFeature = getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections ?? [],
    project: experiment.project ?? "",
  }).includes(gate.sdkCapabilityKey);
  return {
    disabledReason:
      blockedReason ??
      (hasSDKWithFeature
        ? null
        : `The SDKs in this project don't support ${gate.name}. Upgrade your SDK(s) or add a supported SDK.`),
    missingFeature: hasCommercialFeature(gate.commercialFeature)
      ? null
      : gate.commercialFeature,
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
  const { disabledReason, missingFeature } = useLinkedChangeAddGate(
    type,
    experiment,
    blockedReason,
  );
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
      ) : missingFeature ? (
        <PremiumTooltip
          commercialFeature={missingFeature}
          body={PREMIUM_BODY}
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

export function AddImplementationMenu({
  experiment,
  onAdd,
  primary = null,
  blockedReasons = {},
}: {
  experiment: ExperimentInterfaceStringDates;
  onAdd: Record<AddableKind, () => void>;
  primary?: AddableKind | null;
  // Why a kind can't be added right now.
  blockedReasons?: Partial<Record<AddableKind, string | null>>;
}) {
  const items = ADDABLE_KINDS.filter((type) => type !== primary).map((type) => (
    <AddImplementationItem
      key={type}
      type={type}
      experiment={experiment}
      onClick={onAdd[type]}
      blockedReason={blockedReasons[type]}
    />
  ));
  if (!primary) {
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
        {items}
      </DropdownMenu>
    );
  }
  return (
    <SplitButton
      variant="outline"
      menu={
        <DropdownMenu
          trigger={
            <Button
              variant="outline"
              aria-label="Add another kind of implementation"
            >
              <PiCaretDownFill />
            </Button>
          }
          menuPlacement="end"
          variant="soft"
        >
          {items}
        </DropdownMenu>
      }
    >
      <AddImplementationButton
        type={primary}
        experiment={experiment}
        onClick={onAdd[primary]}
        blockedReason={blockedReasons[primary]}
      />
    </SplitButton>
  );
}

// A premium kind can still be added to a draft, which then can't start.
function AddImplementationButton({
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
  const { disabledReason, missingFeature } = useLinkedChangeAddGate(
    type,
    experiment,
    blockedReason,
  );
  const button = (
    <Button
      variant="outline"
      icon={<PiPlus />}
      onClick={onClick}
      disabled={!!disabledReason}
    >
      {ADD_OPTIONS[type].addLabel}
    </Button>
  );
  if (disabledReason) {
    return <Tooltip content={disabledReason}>{button}</Tooltip>;
  }
  if (missingFeature) {
    return (
      <PremiumTooltip
        commercialFeature={missingFeature}
        body={PREMIUM_BODY}
        usePortal
      >
        {button}
      </PremiumTooltip>
    );
  }
  return button;
}

import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { CommercialFeature } from "shared/enterprise";
import {
  SDKCapability,
  getConnectionsSDKCapabilities,
} from "shared/sdk-versioning";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDownFill } from "react-icons/pi";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useUser } from "@/services/UserContext";
import { IMPLEMENTATION_TYPE_OPTIONS } from "@/components/Experiment/ImplementationTypeSelect";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Avatar from "@/ui/Avatar";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";

// What adding each no-code kind needs: an SDK that applies it, and the plan
// feature that lets the experiment start. A Feature Flag needs neither.
const ADD_GATES = {
  visual: {
    header: "Visual Editor",
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
}: {
  type: AddableKind;
  experiment: ExperimentInterfaceStringDates;
  onClick: () => void;
}) {
  const { hasCommercialFeature } = useUser();
  const { unsupportedReason, commercialFeature } = useLinkedChangeAddGate(
    type,
    experiment,
  );
  const option = IMPLEMENTATION_TYPE_OPTIONS[type];
  const color = unsupportedReason ? "text-disabled" : "text-high";
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
      disabled={!!unsupportedReason}
      style={{ padding: 0, height: "auto" }}
    >
      {unsupportedReason ? (
        <Tooltip content={unsupportedReason} side="left">
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

/** A legacy mix adds any kind from one menu, not a button per section. */
export function AddImplementationMenu({
  experiment,
  onFeatureFlag,
  onVisualEditor,
  onUrlRedirect,
  disabledReason = null,
}: {
  experiment: ExperimentInterfaceStringDates;
  // Absent where the experiment can't take another Feature Flag.
  onFeatureFlag: (() => void) | null;
  onVisualEditor: () => void;
  onUrlRedirect: () => void;
  disabledReason?: string | null;
}) {
  const trigger = (
    <Button
      variant="outline"
      icon={<PiCaretDownFill />}
      iconPosition="right"
      disabled={!!disabledReason}
    >
      Add implementation
    </Button>
  );
  if (disabledReason) {
    return <Tooltip content={disabledReason}>{trigger}</Tooltip>;
  }
  return (
    <DropdownMenu trigger={trigger} menuPlacement="end" variant="soft">
      {onFeatureFlag ? (
        <AddImplementationItem
          type="feature"
          experiment={experiment}
          onClick={onFeatureFlag}
        />
      ) : null}
      <AddImplementationItem
        type="visual"
        experiment={experiment}
        onClick={onVisualEditor}
      />
      <AddImplementationItem
        type="urlredirect"
        experiment={experiment}
        onClick={onUrlRedirect}
      />
    </DropdownMenu>
  );
}

/** Until a kind is chosen: what to do instead of adding one. */
export function ImplementationTypePrompt({
  analysisOnly,
  onChooseType,
}: {
  analysisOnly: boolean;
  /** Opens the type chooser; absent when it can't open. */
  onChooseType?: () => void;
}) {
  return (
    <Box className="appbox mb-0" p="4">
      <Flex justify="between" align="center" gap="4">
        <Text color="text-mid">
          {analysisOnly
            ? "This experiment is analysis only."
            : "Choose how this experiment delivers its variations."}
        </Text>
        {onChooseType && (
          <Button variant="outline" onClick={onChooseType}>
            {analysisOnly
              ? "Change implementation type"
              : "Select implementation type"}
          </Button>
        )}
      </Flex>
    </Box>
  );
}

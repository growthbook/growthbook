import { CommercialFeature } from "shared/enterprise";
import {
  SDKCapability,
  getConnectionsSDKCapabilities,
} from "shared/sdk-versioning";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { Box, Flex, Separator, type AvatarProps } from "@radix-ui/themes";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import useSDKConnections from "@/hooks/useSDKConnections";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import Text from "@/ui/Text";
import Avatar from "@/ui/Avatar";
import Button from "@/ui/Button";
import { ICON_PROPERTIES, LinkedChange } from "./constants";

export const LINKED_CHANGES: Record<
  LinkedChange,
  {
    header: string;
    cta: string;
    description: string;
    commercialFeature: CommercialFeature | "";
    sdkCapabilityKey: SDKCapability | "";
  }
> = {
  "feature-flag": {
    header: "Feature Flag",
    cta: "Link Feature Flag",
    description:
      "Use feature flags and SDKs to make changes in your front-end, back-end or mobile application code.",
    commercialFeature: "",
    sdkCapabilityKey: "",
  },
  "visual-editor": {
    header: "AI Visual Editor",
    cta: "Launch AI Visual Editor",
    description:
      "Use our no-code browser extension to A/B test minor changes, such as headings or button text.",
    commercialFeature: "visual-editor",
    sdkCapabilityKey: "visualEditor",
  },
  redirects: {
    header: "URL Redirects",
    cta: "Add URL Redirect",
    description:
      "Use our no-code tool to A/B test URL redirects for whole pages, or to test parts of a URL.",
    commercialFeature: "redirects",
    sdkCapabilityKey: "redirects",
  },
};

export type LinkedChangeTarget = {
  project: string;
  noun: string;
  types: LinkedChange[];
  extraSdkCapabilities?: Partial<Record<LinkedChange, SDKCapability[]>>;
  sdkUnsupportedCopy?: Partial<Record<LinkedChange, string>>;
};

export function linkedChangeSdkUnsupportedCopy(
  type: LinkedChange,
  target: LinkedChangeTarget,
): string {
  return (
    target.sdkUnsupportedCopy?.[type] ??
    `The SDKs in this project don't support ${LINKED_CHANGES[type].header}. Upgrade your SDK(s) or add a supported SDK.`
  );
}

export function linkedChangePremiumCopy(target: LinkedChangeTarget): string {
  return `You can add this to your draft, but you will not be able to start the ${target.noun} until upgrading.`;
}

export function linkedChangeSdkSupported(
  type: LinkedChange,
  target: LinkedChangeTarget,
  connections: Partial<SDKConnectionInterface>[],
): boolean {
  const required: SDKCapability[] = [
    ...(LINKED_CHANGES[type].sdkCapabilityKey
      ? [LINKED_CHANGES[type].sdkCapabilityKey as SDKCapability]
      : []),
    ...(target.extraSdkCapabilities?.[type] ?? []),
  ];
  if (required.length === 0) return true;
  const capabilities = getConnectionsSDKCapabilities({
    connections,
    project: target.project,
  });
  return required.every((c) => capabilities.includes(c));
}

const AddLinkedChangeRow = ({
  type,
  setModal,
  target,
}: {
  type: LinkedChange;
  setModal: (open: boolean) => void;
  target: LinkedChangeTarget;
}) => {
  const { header, cta, description, commercialFeature } = LINKED_CHANGES[type];
  const { component: Icon, radixColor } = ICON_PROPERTIES[type];
  const { data: sdkConnectionsData } = useSDKConnections();

  const { hasCommercialFeature } = useUser();
  const hasFeature = commercialFeature
    ? hasCommercialFeature(commercialFeature)
    : true;

  const isCTAClickable = linkedChangeSdkSupported(
    type,
    target,
    sdkConnectionsData?.connections ?? [],
  );

  return (
    <Flex align="center" justify="between" gap="3" width="100%">
      <Flex align="center" direction="row" flexGrow="1" minWidth="0" gap="5">
        <Box width="150px" flexShrink="0">
          <Avatar
            radius="full"
            color={radixColor as AvatarProps["color"]}
            size="md"
            variant="soft"
            mr="2"
          >
            <Icon />
          </Avatar>
          <Text size="lg" weight="semibold" color="text-high">
            {header}
          </Text>
        </Box>
        <Box flexGrow="1" minWidth="0">
          <Text color="text-low">{description}</Text>
        </Box>
      </Flex>
      <Box flexShrink="0">
        {isCTAClickable ? (
          commercialFeature && !hasFeature ? (
            <PremiumTooltip
              commercialFeature={commercialFeature}
              body={linkedChangePremiumCopy(target)}
              usePortal={true}
            >
              <Button
                variant="ghost"
                onClick={() => {
                  setModal(true);
                }}
              >
                {cta}
              </Button>
            </PremiumTooltip>
          ) : (
            <Button
              variant="ghost"
              onClick={() => {
                setModal(true);
              }}
            >
              {cta}
            </Button>
          )
        ) : (
          <Tooltip
            body={linkedChangeSdkUnsupportedCopy(type, target)}
            tipPosition="top"
          >
            <Button variant="ghost" disabled>
              {cta}
            </Button>
          </Tooltip>
        )}
      </Box>
    </Flex>
  );
};

export default function AddLinkedChanges({
  target,
  canAdd,
  numLinkedChanges,
  setFeatureModal,
  setVisualEditorModal,
  setUrlRedirectModal,
}: {
  target: LinkedChangeTarget;
  canAdd: boolean;
  numLinkedChanges: number;
  setFeatureModal?: (state: boolean) => unknown;
  setVisualEditorModal?: (state: boolean) => unknown;
  setUrlRedirectModal?: (state: boolean) => unknown;
}) {
  if (!canAdd) return null;
  // Already has linked changes
  if (numLinkedChanges && numLinkedChanges > 0) return null;

  const setModalFor: Record<
    LinkedChange,
    ((state: boolean) => unknown) | undefined
  > = {
    "feature-flag": setFeatureModal,
    "visual-editor": setVisualEditorModal,
    redirects: setUrlRedirectModal,
  };
  const sections = target.types.flatMap((type) => {
    const setModal = setModalFor[type];
    return setModal ? [{ type, setModal }] : [];
  });
  if (sections.length === 0) return null;

  return (
    <Box className="appbox mb-0" p="4" mt="2" mb="0">
      {sections.map(({ type, setModal }, i) => (
        <Box key={type}>
          <AddLinkedChangeRow type={type} setModal={setModal} target={target} />
          {i < sections.length - 1 && <Separator size="4" my="3" />}
        </Box>
      ))}
    </Box>
  );
}

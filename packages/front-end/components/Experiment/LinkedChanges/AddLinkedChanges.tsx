import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { CommercialFeature } from "shared/enterprise";
import {
  SDKCapability,
  getConnectionsSDKCapabilities,
} from "shared/sdk-versioning";
import { Box, Flex, Separator, type AvatarProps } from "@radix-ui/themes";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import useSDKConnections from "@/hooks/useSDKConnections";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import Text from "@/ui/Text";
import Avatar from "@/ui/Avatar";
import Button from "@/ui/Button";
import Heading from "@/ui/Heading";
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
    header: "Visual Editor",
    cta: "Launch Visual Editor",
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

const AddLinkedChangeRow = ({
  type,
  setModal,
  experiment,
}: {
  type: LinkedChange;
  setModal: (open: boolean) => void;
  experiment: ExperimentInterfaceStringDates;
}) => {
  const { header, cta, description, commercialFeature, sdkCapabilityKey } =
    LINKED_CHANGES[type];
  const { component: Icon, radixColor } = ICON_PROPERTIES[type];
  const { data: sdkConnectionsData } = useSDKConnections();

  const { hasCommercialFeature } = useUser();
  const hasFeature = commercialFeature
    ? hasCommercialFeature(commercialFeature)
    : true;

  const hasSDKWithFeature =
    type === "feature-flag" ||
    getConnectionsSDKCapabilities({
      connections: sdkConnectionsData?.connections ?? [],
      project: experiment.project ?? "",
    }).includes(sdkCapabilityKey as SDKCapability);

  const isCTAClickable = hasSDKWithFeature;

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
          <Text size="large" weight="semibold" color="text-high">
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
              body={
                "You can add this to your draft, but you will not be able to start the experiment until upgrading."
              }
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
            body={`The SDKs in this project don't support ${header}. Upgrade your SDK(s) or add a supported SDK.`}
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
  experiment,
  numLinkedChanges,
  hasLinkedFeatures,
  setFeatureModal,
  setVisualEditorModal,
  setUrlRedirectModal,
}: {
  experiment: ExperimentInterfaceStringDates;
  numLinkedChanges: number;
  hasLinkedFeatures?: boolean;
  setVisualEditorModal: (state: boolean) => unknown;
  setFeatureModal: (state: boolean) => unknown;
  setUrlRedirectModal: (state: boolean) => unknown;
}) {
  if (experiment.status !== "draft") return null;
  if (experiment.archived) return null;
  // Already has linked changes
  if (numLinkedChanges && numLinkedChanges > 0) return null;

  const sections = {
    "feature-flag": {
      render: !hasLinkedFeatures,
      setModal: setFeatureModal,
    },
    "visual-editor": {
      render: !experiment.hasVisualChangesets,
      setModal: setVisualEditorModal,
    },
    redirects: {
      render: !experiment.hasURLRedirects,
      setModal: setUrlRedirectModal,
    },
  };

  const possibleSections = Object.keys(sections);

  return (
    <Box className="appbox" p="5" my="5">
      {numLinkedChanges > 0 ? (
        <>
          <Heading as="h4" size="small">
            Add Implementation
          </Heading>
        </>
      ) : (
        <>
          <Heading as="h4" size="small">
            Select an Implementation
          </Heading>
        </>
      )}
      <Box className="appbox mb-0" p="4" mt="2" mb="0">
        {possibleSections.map((s, i) => {
          return (
            <Box key={s}>
              <AddLinkedChangeRow
                type={s as LinkedChange}
                setModal={sections[s].setModal}
                experiment={experiment}
              />
              {i < possibleSections.length - 1 && <Separator size="4" my="3" />}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

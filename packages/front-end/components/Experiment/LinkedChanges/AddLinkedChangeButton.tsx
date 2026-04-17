import { Flex, type AvatarProps } from "@radix-ui/themes";
import { PiCaretDownFill } from "react-icons/pi";
import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { URLRedirectInterface } from "shared/types/url-redirect";
import {
  getConnectionsSDKCapabilities,
  SDKCapability,
} from "shared/sdk-versioning";
import Avatar from "@/ui/Avatar";
import Text from "@/ui/Text";
import SplitButton from "@/ui/SplitButton";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useUser } from "@/services/UserContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import {
  ICON_PROPERTIES,
  LINKED_CHANGE_CONTAINER_PROPERTIES,
  type LinkedChange,
} from "./constants";
import { LINKED_CHANGES } from "./AddLinkedChanges";

const MENU_ITEM_DESCRIPTIONS: Record<LinkedChange, string> = {
  "feature-flag": "Make code changes in your app",
  "visual-editor": "No-code browser extension",
  redirects: "A/B test URL redirects",
};
const MENU_ITEM_HEADERS: Record<LinkedChange, string> = {
  "feature-flag": "Feature Flag",
  "visual-editor": "Visual Editor",
  redirects: "URL Redirect",
};

const LinkedChangeMenuItemContent = ({
  icon,
  iconColor,
  header,
  description,
  textColor,
}: {
  icon: React.ReactElement;
  iconColor: AvatarProps["color"];
  header: string;
  description: string;
  textColor: "text-high" | "text-disabled";
}) => {
  return (
    <Flex align="center" gap="2" p="3">
      <Avatar radius="small" color={iconColor} size="sm" variant="soft">
        {icon}
      </Avatar>
      <Flex direction="column">
        <Text color={textColor} weight="semibold">
          {header}
        </Text>
        <Text color={textColor}>{description}</Text>
      </Flex>
    </Flex>
  );
};

const LinkedChangeMenuItem = ({
  type,
  experiment,
  onClick,
}: {
  type: LinkedChange;
  experiment: ExperimentInterfaceStringDates;
  onClick: () => void;
}) => {
  const { radixColor, component: Icon } = ICON_PROPERTIES[type];
  const description = MENU_ITEM_DESCRIPTIONS[type];
  const { commercialFeature, sdkCapabilityKey, header } = LINKED_CHANGES[type];
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
  const textColor = isCTAClickable ? "text-high" : "text-disabled";
  return (
    <DropdownMenuItem
      onClick={onClick}
      disabled={!isCTAClickable}
      style={{ padding: 0, height: "auto" }}
    >
      {isCTAClickable ? (
        commercialFeature && !hasFeature ? (
          <PremiumTooltip
            commercialFeature={commercialFeature}
            body={
              "You can add this to your draft, but you will not be able to start the experiment until upgrading."
            }
            tipPosition="left"
          >
            <LinkedChangeMenuItemContent
              icon={<Icon />}
              iconColor={radixColor as AvatarProps["color"]}
              header={MENU_ITEM_HEADERS[type]}
              description={description}
              textColor={textColor}
            />
          </PremiumTooltip>
        ) : (
          <LinkedChangeMenuItemContent
            icon={<Icon />}
            iconColor={radixColor as AvatarProps["color"]}
            header={MENU_ITEM_HEADERS[type]}
            description={description}
            textColor={textColor}
          />
        )
      ) : (
        <Tooltip
          body={`The SDKs in this project don't support ${header}. Upgrade your SDK(s) or add a supported SDK.`}
          tipPosition="left"
          shouldDisplay={!isCTAClickable}
        >
          <LinkedChangeMenuItemContent
            icon={<Icon />}
            iconColor={radixColor as AvatarProps["color"]}
            header={MENU_ITEM_HEADERS[type]}
            description={description}
            textColor={textColor}
          />
        </Tooltip>
      )}
    </DropdownMenuItem>
  );
};

type Props = {
  onFeatureFlag: () => void;
  onVisualEditor: () => void;
  onUrlRedirect: () => void;
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  experiment: ExperimentInterfaceStringDates;
};

const LinkedChangesDropdown = ({
  experiment,
  onFeatureFlag,
  onVisualEditor,
  onUrlRedirect,
  cta,
}: {
  experiment: ExperimentInterfaceStringDates;
  onFeatureFlag: () => void;
  onVisualEditor: () => void;
  onUrlRedirect: () => void;
  cta?: string;
}) => {
  return (
    <DropdownMenu
      trigger={
        <Button>
          {cta && (
            <Text weight="semibold" mr="2">
              {cta}
            </Text>
          )}
          <PiCaretDownFill />
        </Button>
      }
    >
      <LinkedChangeMenuItem
        type="feature-flag"
        experiment={experiment}
        onClick={onFeatureFlag}
      />
      <LinkedChangeMenuItem
        type="visual-editor"
        experiment={experiment}
        onClick={onVisualEditor}
      />
      <LinkedChangeMenuItem
        type="redirects"
        experiment={experiment}
        onClick={onUrlRedirect}
      />
    </DropdownMenu>
  );
};

export default function AddLinkedChangeButton({
  linkedFeatures,
  visualChangesets,
  urlRedirects,
  onFeatureFlag,
  onVisualEditor,
  onUrlRedirect,
  experiment,
}: Props) {
  // Determine the type of implementation. If there are multiple types, return multiple
  const implementationType =
    linkedFeatures.length > 0 &&
    !visualChangesets.length &&
    !urlRedirects.length
      ? "feature-flag"
      : visualChangesets.length > 0 &&
          !linkedFeatures.length &&
          !urlRedirects.length
        ? "visual-editor"
        : urlRedirects.length > 0 &&
            !linkedFeatures.length &&
            !visualChangesets.length
          ? "redirects"
          : "multiple";

  const handleAddClick = () => {
    if (implementationType === "feature-flag") {
      onFeatureFlag();
    } else if (implementationType === "visual-editor") {
      onVisualEditor();
    } else if (implementationType === "redirects") {
      onUrlRedirect();
    }
  };

  // If there are multiple linked change types, show the dropdown menu
  if (implementationType === "multiple") {
    return (
      <LinkedChangesDropdown
        cta="Add Implementation"
        onFeatureFlag={onFeatureFlag}
        onVisualEditor={onVisualEditor}
        onUrlRedirect={onUrlRedirect}
        experiment={experiment}
      />
    );
  }

  // If there is only one linked change type, show a split button with a main CTA
  // to add another linked change of the same type
  return (
    <SplitButton
      menu={
        <LinkedChangesDropdown
          experiment={experiment}
          onFeatureFlag={onFeatureFlag}
          onVisualEditor={onVisualEditor}
          onUrlRedirect={onUrlRedirect}
        />
      }
    >
      <Button onClick={() => handleAddClick()}>
        {LINKED_CHANGE_CONTAINER_PROPERTIES[implementationType].addButtonCopy}
      </Button>
    </SplitButton>
  );
}

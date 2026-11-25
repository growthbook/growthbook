import { Flex, type AvatarProps } from "@radix-ui/themes";
import { PiCaretDownFill } from "react-icons/pi";
import { LinkedFeatureInfo } from "shared/types/experiment";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { URLRedirectInterface } from "shared/types/url-redirect";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
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
import {
  LINKED_CHANGES,
  linkedChangePremiumCopy,
  linkedChangeSdkSupported,
  linkedChangeSdkUnsupportedCopy,
  type LinkedChangeTarget,
} from "./AddLinkedChanges";

const MENU_ITEM_DESCRIPTIONS: Record<LinkedChange, MessageDescriptor> = {
  "feature-flag": msg`Make code changes in your app`,
  "visual-editor": msg`No-code browser extension`,
  redirects: msg`A/B test URL redirects`,
};
const MENU_ITEM_HEADERS: Record<LinkedChange, MessageDescriptor> = {
  "feature-flag": msg`Feature Flag`,
  "visual-editor": msg`AI Visual Editor`,
  redirects: msg`URL Redirect`,
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
  target,
  onClick,
}: {
  type: LinkedChange;
  target: LinkedChangeTarget;
  onClick: () => void;
}) => {
  const { i18n } = useLingui();
  const { radixColor, component: Icon } = ICON_PROPERTIES[type];
  const description = i18n._(MENU_ITEM_DESCRIPTIONS[type]);
  const header = i18n._(MENU_ITEM_HEADERS[type]);
  const { commercialFeature } = LINKED_CHANGES[type];
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
            body={linkedChangePremiumCopy(target, i18n)}
            tipPosition="left"
          >
            <LinkedChangeMenuItemContent
              icon={<Icon />}
              iconColor={radixColor as AvatarProps["color"]}
              header={header}
              description={description}
              textColor={textColor}
            />
          </PremiumTooltip>
        ) : (
          <LinkedChangeMenuItemContent
            icon={<Icon />}
            iconColor={radixColor as AvatarProps["color"]}
            header={header}
            description={description}
            textColor={textColor}
          />
        )
      ) : (
        <Tooltip
          body={linkedChangeSdkUnsupportedCopy(type, target, i18n)}
          tipPosition="left"
          shouldDisplay={!isCTAClickable}
        >
          <LinkedChangeMenuItemContent
            icon={<Icon />}
            iconColor={radixColor as AvatarProps["color"]}
            header={header}
            description={description}
            textColor={textColor}
          />
        </Tooltip>
      )}
    </DropdownMenuItem>
  );
};

type Handlers = Record<LinkedChange, (() => void) | undefined>;

type Props = {
  onFeatureFlag?: () => void;
  onVisualEditor?: () => void;
  onUrlRedirect?: () => void;
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
  target: LinkedChangeTarget;
};

const LinkedChangesDropdown = ({
  target,
  handlers,
  cta,
}: {
  target: LinkedChangeTarget;
  handlers: Handlers;
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
      variant="soft"
    >
      {target.types.map((type) => {
        const onClick = handlers[type];
        if (!onClick) return null;
        return (
          <LinkedChangeMenuItem
            key={type}
            type={type}
            target={target}
            onClick={onClick}
          />
        );
      })}
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
  target,
}: Props) {
  const { t, i18n } = useLingui();
  const { data: sdkConnectionsData } = useSDKConnections();
  const handlers: Handlers = {
    "feature-flag": onFeatureFlag,
    "visual-editor": onVisualEditor,
    redirects: onUrlRedirect,
  };
  const counts: Record<LinkedChange, number> = {
    "feature-flag": linkedFeatures.length,
    "visual-editor": visualChangesets.length,
    redirects: urlRedirects.length,
  };
  const inUse = target.types.filter((type) => counts[type] > 0);
  const single = inUse.length === 1 ? inUse[0] : null;
  const singleHandler = single ? handlers[single] : undefined;

  if (!single || !singleHandler) {
    return (
      <LinkedChangesDropdown
        cta={t`Add Implementation`}
        target={target}
        handlers={handlers}
      />
    );
  }

  const singleSupported = linkedChangeSdkSupported(
    single,
    target,
    sdkConnectionsData?.connections ?? [],
  );
  const cta = (
    <Button onClick={singleHandler} disabled={!singleSupported}>
      {i18n._(LINKED_CHANGE_CONTAINER_PROPERTIES[single].addButtonCopy)}
    </Button>
  );

  return (
    <SplitButton
      menu={<LinkedChangesDropdown target={target} handlers={handlers} />}
    >
      {singleSupported ? (
        cta
      ) : (
        <Tooltip
          body={linkedChangeSdkUnsupportedCopy(single, target, i18n)}
          tipPosition="top"
        >
          {cta}
        </Tooltip>
      )}
    </SplitButton>
  );
}

import { CommercialFeature } from "shared/enterprise";
import {
  SDKCapability,
  someConnectionSupportsCapabilities,
} from "shared/sdk-versioning";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ReactElement } from "react";
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Box, Flex, Separator, type AvatarProps } from "@radix-ui/themes";
import {
  PiCaretDownFill,
  PiDesktop,
  PiFlag,
  PiLink,
  PiPlus,
} from "react-icons/pi";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useUser } from "@/services/UserContext";
import Avatar from "@/ui/Avatar";
import Frame from "@/ui/Frame";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Text from "@/ui/Text";
import Button from "@/ui/Button";
import SplitButton from "@/ui/SplitButton";
import Tooltip from "@/ui/Tooltip";
import { ICON_PROPERTIES, LinkedChange } from "./constants";

export const LINKED_CHANGES: Record<
  LinkedChange,
  {
    header: MessageDescriptor;
    cta: MessageDescriptor;
    description: MessageDescriptor;
    commercialFeature: CommercialFeature | "";
    sdkCapabilityKey: SDKCapability | "";
  }
> = {
  "feature-flag": {
    header: msg`Feature Flag`,
    cta: msg`Link Feature Flag`,
    description: msg`Use feature flags and SDKs to make changes in your front-end, back-end or mobile application code.`,
    commercialFeature: "",
    sdkCapabilityKey: "",
  },
  "visual-editor": {
    header: msg`AI Visual Editor`,
    cta: msg`Launch AI Visual Editor`,
    description: msg`Use our no-code browser extension to A/B test minor changes, such as headings or button text.`,
    commercialFeature: "visual-editor",
    sdkCapabilityKey: "visualEditor",
  },
  redirects: {
    header: msg`URL Redirects`,
    cta: msg`Add URL Redirect`,
    description: msg`Use our no-code tool to A/B test URL redirects for whole pages, or to test parts of a URL.`,
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
  i18n: I18n,
): string {
  const header = i18n._(LINKED_CHANGES[type].header);
  return (
    target.sdkUnsupportedCopy?.[type] ??
    i18n._(
      msg`The SDKs in this Project don't support ${header}. Upgrade your SDK(s) or add a supported SDK.`,
    )
  );
}

export function linkedChangePremiumCopy(
  target: LinkedChangeTarget,
  i18n: I18n,
): string {
  const noun = target.noun;
  return i18n._(
    msg`You can add this to your draft, but you will not be able to start the ${noun} until upgrading.`,
  );
}

export function linkedChangeSdkSupported(
  type: LinkedChange,
  target: LinkedChangeTarget,
  connections: Partial<SDKConnectionInterface>[],
): boolean {
  const base = LINKED_CHANGES[type].sdkCapabilityKey;
  const required: SDKCapability[] = [
    ...(base ? [base] : []),
    ...(target.extraSdkCapabilities?.[type] ?? []),
  ];
  if (required.length === 0) return true;
  return someConnectionSupportsCapabilities({
    connections,
    capabilities: required,
    project: target.project,
  });
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
  const { i18n } = useLingui();
  const {
    header: headerMessage,
    cta: ctaMessage,
    description: descriptionMessage,
    commercialFeature,
  } = LINKED_CHANGES[type];
  const header = i18n._(headerMessage);
  const cta = i18n._(ctaMessage);
  const description = i18n._(descriptionMessage);
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
        <Box minWidth="170px" flexShrink="0">
          <Avatar
            radius="full"
            color={radixColor as AvatarProps["color"]}
            size="md"
            variant="soft"
            mr="2"
          >
            <Icon />
          </Avatar>
          <Text
            size="lg"
            weight="semibold"
            color="text-high"
            whiteSpace="nowrap"
          >
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
              body={linkedChangePremiumCopy(target, i18n)}
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
            content={linkedChangeSdkUnsupportedCopy(type, target, i18n)}
            side="top"
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

// The experiment page's own add controls.
type AddableKind = "feature" | "visual" | "urlredirect";
export const ADDABLE_KINDS: AddableKind[] = [
  "feature",
  "visual",
  "urlredirect",
];

const ADD_OPTIONS: Record<
  AddableKind,
  {
    header: MessageDescriptor;
    description: MessageDescriptor;
    addLabel: MessageDescriptor;
    icon: ReactElement;
    color: AvatarProps["color"];
    kind: LinkedChange;
  }
> = {
  feature: {
    header: msg`Feature Flag`,
    description: msg`Make code changes in your app`,
    addLabel: msg`Feature Flag`,
    icon: <PiFlag />,
    color: ICON_PROPERTIES["feature-flag"].radixColor,
    kind: "feature-flag",
  },
  visual: {
    header: msg`AI Visual Editor`,
    description: msg`No-code browser extension`,
    addLabel: msg`AI Visual Editor changes`,
    icon: <PiDesktop />,
    color: ICON_PROPERTIES["visual-editor"].radixColor,
    kind: "visual-editor",
  },
  urlredirect: {
    header: msg`URL Redirect`,
    description: msg`A/B test URL redirects`,
    addLabel: msg`URL redirect`,
    icon: <PiLink />,
    color: ICON_PROPERTIES.redirects.radixColor,
    kind: "redirects",
  },
};

const experimentTarget = (
  experiment: ExperimentInterfaceStringDates,
): LinkedChangeTarget => ({
  project: experiment.project ?? "",
  noun: "experiment",
  types: ["feature-flag", "visual-editor", "redirects"],
});

// Why this kind can't be added now, or the plan feature it lacks to start.
function useLinkedChangeAddGate(
  type: AddableKind,
  experiment: ExperimentInterfaceStringDates,
  blockedReason: string | null | undefined,
): {
  disabledReason: string | null;
  missingFeature: CommercialFeature | null;
} {
  const { i18n } = useLingui();
  const { data: sdkConnectionsData } = useSDKConnections();
  const { hasCommercialFeature } = useUser();
  const { kind } = ADD_OPTIONS[type];
  const { commercialFeature } = LINKED_CHANGES[kind];
  const target = experimentTarget(experiment);
  const sdkSupported = linkedChangeSdkSupported(
    kind,
    target,
    sdkConnectionsData?.connections ?? [],
  );
  return {
    disabledReason:
      blockedReason ??
      (sdkSupported
        ? null
        : linkedChangeSdkUnsupportedCopy(kind, target, i18n)),
    missingFeature:
      commercialFeature && !hasCommercialFeature(commercialFeature)
        ? commercialFeature
        : null,
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
  const { i18n } = useLingui();
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
          {i18n._(option.header)}
        </Text>
        <Text color={color}>{i18n._(option.description)}</Text>
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
          body={linkedChangePremiumCopy(experimentTarget(experiment), i18n)}
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
  // The kind the main button adds; none while nothing is added yet, when
  // each kind is listed with what it's for.
  primary?: AddableKind | null;
  // Why a kind can't be added right now.
  blockedReasons?: Partial<Record<AddableKind, string | null>>;
}) {
  const { t, i18n } = useLingui();
  if (!primary) {
    return (
      <Frame width="100%" mb="0" px="4" py="2">
        {ADDABLE_KINDS.map((type, i) => (
          <Box key={type}>
            {i > 0 ? <Separator size="4" /> : null}
            <Flex align="center" justify="between" gap="3" py="2">
              <Flex align="center" gap="3" minWidth="0">
                <Avatar
                  radius="small"
                  color={ADD_OPTIONS[type].color}
                  size="sm"
                  variant="soft"
                >
                  {ADD_OPTIONS[type].icon}
                </Avatar>
                <Text weight="semibold" color="text-high" whiteSpace="nowrap">
                  {i18n._(ADD_OPTIONS[type].header)}
                </Text>
                <Text color="text-mid">
                  {i18n._(ADD_OPTIONS[type].description)}
                </Text>
              </Flex>
              <AddImplementationButton
                type={type}
                experiment={experiment}
                onClick={onAdd[type]}
                blockedReason={blockedReasons[type]}
                ghost
              />
            </Flex>
          </Box>
        ))}
      </Frame>
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
              aria-label={t`Add another kind of implementation`}
            >
              <PiCaretDownFill />
            </Button>
          }
          menuPlacement="end"
          variant="soft"
        >
          {ADDABLE_KINDS.filter((type) => type !== primary).map((type) => (
            <AddImplementationItem
              key={type}
              type={type}
              experiment={experiment}
              onClick={onAdd[type]}
              blockedReason={blockedReasons[type]}
            />
          ))}
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
  ghost = false,
}: {
  type: AddableKind;
  experiment: ExperimentInterfaceStringDates;
  onClick: () => void;
  blockedReason?: string | null;
  ghost?: boolean;
}) {
  const { t, i18n } = useLingui();
  const { disabledReason, missingFeature } = useLinkedChangeAddGate(
    type,
    experiment,
    blockedReason,
  );
  // Once there's a page of changes, this adds another rather than reopening it.
  const label =
    type === "visual" && experiment.hasVisualChangesets
      ? t`Another AI Visual Editor page`
      : i18n._(ADD_OPTIONS[type].addLabel);
  const button = (
    <Button
      variant={ghost ? "ghost" : "outline"}
      icon={<PiPlus />}
      onClick={onClick}
      disabled={!!disabledReason}
      aria-label={t`Add ${label}`}
    >
      {label}
    </Button>
  );
  if (disabledReason) {
    return <Tooltip content={disabledReason}>{button}</Tooltip>;
  }
  if (missingFeature) {
    return (
      <PremiumTooltip
        commercialFeature={missingFeature}
        body={linkedChangePremiumCopy(experimentTarget(experiment), i18n)}
        usePortal
      >
        {button}
      </PremiumTooltip>
    );
  }
  return button;
}

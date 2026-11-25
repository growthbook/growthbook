import { ReactNode } from "react";
import { PiInfo } from "react-icons/pi";
import { Box } from "@radix-ui/themes";
import { SavedGroupFormat } from "shared/types/sdk-connection";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import HelperText from "@/ui/HelperText";
import Tooltip from "@/ui/Tooltip";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { DocLink } from "@/components/DocLink";

export const CATEGORY_TITLES = {
  payloadSecurity: msg`Payload Security`,
  experiments: msg`Experiments`,
  savedGroups: msg`Saved Groups`,
  payloadMetadata: msg`Payload Metadata`,
  observability: msg`Observability and QA`,
  proxy: msg`GrowthBook Proxy`,
} as const;

export const DELIVERY_LABELS = {
  plain: msg`Plain Text`,
  ciphered: msg`Ciphered`,
  remote: msg`Remote Evaluated`,
} as const;

export const SETTING_TITLES = {
  visualEditor: msg`Enable Visual Editor experiments`,
  urlRedirect: msg`Enable URL Redirect experiments`,
  hideNames: msg`Hide names from payload`,
  savedGroupReferences: msg`Pass Saved Groups by reference`,
  passByReference: msg`Pass by reference`,
  prerequisites: msg`Always include prerequisite Feature Flags`,
  encryptPayload: msg`Encrypt payload`,
  hashSecureAttributes: msg`Hash secure attributes`,
  // Under an "Include" label.
  includeMetadata: msg`Include`,
  projectIds: msg`Project IDs`,
  customFields: msg`Custom Fields`,
  tags: msg`Tags`,
  scheduleDates: msg`Experiment schedule dates`,
  ruleIds: msg`Include feature rule IDs in payload`,
  draftRules: msg`Include draft Experiment rules in feature definitions`,
  draftExperiments: msg`Include draft Visual Editor and URL Redirect experiments`,
  useProxy: msg`Use GrowthBook Proxy`,
  proxyHost: msg`Proxy Host URL`,
} as const;

export const SAVED_GROUP_FORMAT_LABELS: Record<
  SavedGroupFormat,
  MessageDescriptor
> = {
  inline: msg`Off`,
  referencesV1: msg`ID Lists only`,
  referencesV2: msg`All Saved Groups`,
};

// A setting's tips open beside it and close as the pointer leaves, so moving
// down the form reaches the next one.
const SETTING_TIP = {
  side: "right",
  disableHoverableContent: true,
} as const;
export const SETTING_PREMIUM_TIP = {
  tipPosition: "right",
  popperStyle: { pointerEvents: "none" },
} as const;

// One of the titles above, in the UI's language, where a hook can't resolve
// it: a setting row's read view or a revision diff.
export function SettingText({ text }: { text: MessageDescriptor }) {
  const { i18n } = useLingui();
  return <>{i18n._(text)}</>;
}

// A label and its info icon as one run of text, spaced as words are whatever
// lays out what holds it (a PremiumTooltip's row gaps its children).
export function WithInfoIcon({ children }: { children: ReactNode }) {
  return (
    <span>
      {children}{" "}
      <Box as="span" display="inline-block">
        <PiInfo />
      </Box>
    </span>
  );
}

// Every setting's info icon, so they all look and behave alike.
export function InfoTooltip({ content }: { content: ReactNode }) {
  const { t } = useLingui();
  return (
    <Tooltip content={content} {...SETTING_TIP}>
      <Box
        as="span"
        display="inline-block"
        tabIndex={0}
        aria-label={t`More information`}
      >
        <PiInfo />
      </Box>
    </Tooltip>
  );
}

export function VisualEditorLabel() {
  return (
    <>
      <Trans>
        Enable <strong>Visual Editor</strong> experiments (
        <DocLink docSection="visual_editor">docs</DocLink>)
      </Trans>
    </>
  );
}

export function UrlRedirectLabel() {
  return (
    <>
      <Trans>
        Enable <strong>URL Redirect</strong> experiments (
        <DocLink docSection="url_redirects">docs</DocLink>)
      </Trans>
    </>
  );
}

export function HideNamesLabel() {
  const { i18n } = useLingui();
  return (
    <>
      {i18n._(SETTING_TITLES.hideNames)}{" "}
      <InfoTooltip
        content={
          <>
            <p>
              <Trans>
                Strips every <code>experiment.name</code> and per-variation{" "}
                <code>name</code> from the SDK payload. The SDK&apos;s{" "}
                <code>trackingCallback</code> still receives stable{" "}
                <code>key</code> / <code>variationId</code> values.
              </Trans>
            </p>
            <p>
              <Trans>
                Experiment and variation names can help add context when
                debugging or tracking events, but could expose potentially
                sensitive information to your users in a client-side or mobile
                application.
              </Trans>
            </p>
            <p>
              <Trans>
                For maximum privacy and security, we recommend hiding these
                fields.
              </Trans>
            </p>
          </>
        }
      />
    </>
  );
}

export function SavedGroupReferencesLabel({
  remoteEvalEnabled,
}: {
  remoteEvalEnabled: boolean;
}) {
  const { i18n } = useLingui();
  return (
    <PremiumTooltip
      commercialFeature="large-saved-groups"
      {...SETTING_PREMIUM_TIP}
      body={
        <>
          <p>
            <Trans>
              Passing Saved Groups by reference sends each group once in its own
              key instead of copying it into every rule that uses it, so
              re-using a group stops growing the payload.
            </Trans>
          </p>
          <HelperText status="warning" size="sm">
            {remoteEvalEnabled ? (
              <Trans>
                Older SDK versions and remote evaluation tools (e.g. GrowthBook
                Proxy) cannot read references. Check your SDK is up to date
                before changing this.
              </Trans>
            ) : (
              <Trans>
                Older SDK versions cannot read references. Check your SDK is up
                to date before changing this.
              </Trans>
            )}
          </HelperText>
        </>
      }
    >
      <WithInfoIcon>{i18n._(SETTING_TITLES.passByReference)}</WithInfoIcon>
    </PremiumTooltip>
  );
}

export function PrerequisitesLabel() {
  const { t, i18n } = useLingui();
  return (
    <>
      {i18n._(SETTING_TITLES.prerequisites)}{" "}
      <InfoTooltip
        content={t`Deliver prerequisite Feature Flags that target other Projects. Without them, the Feature Flags they gate are always off. Only applies when this connection filters by Project.`}
      />
    </>
  );
}

export function ProjectIdsLabel() {
  const { i18n } = useLingui();
  return (
    <>
      {i18n._(SETTING_TITLES.projectIds)}{" "}
      <InfoTooltip
        content={
          <>
            <p>
              <Trans>
                When enabled, each feature and experiment in the SDK payload
                will include a <code>metadata.projects</code> array containing
                the project&apos;s public ID (or internal ID if no public ID is
                set).
              </Trans>
            </p>
            <p>
              <Trans>
                Features and rules that target all projects omit the array by
                convention — treat a missing <code>metadata.projects</code> as
                &quot;all projects&quot;.
              </Trans>
            </p>
          </>
        }
      />
    </>
  );
}

export function CustomFieldsLabel() {
  const { i18n } = useLingui();
  return (
    <>
      {i18n._(SETTING_TITLES.customFields)}{" "}
      <InfoTooltip
        content={
          <p>
            <Trans>
              Select specific custom field values to include in the{" "}
              <code>metadata.customFields</code> object for each feature and
              experiment.
            </Trans>
          </p>
        }
      />
    </>
  );
}

export function TagsLabel() {
  const { i18n } = useLingui();
  return (
    <>
      {i18n._(SETTING_TITLES.tags)}{" "}
      <InfoTooltip
        content={
          <>
            <Trans>
              When enabled, all feature tags will be included in the{" "}
              <code>metadata.tags</code> array for each feature in the SDK
              payload.
            </Trans>
          </>
        }
      />
    </>
  );
}

export function ScheduleDatesLabel() {
  const { i18n } = useLingui();
  return (
    <>
      {i18n._(SETTING_TITLES.scheduleDates)}{" "}
      <InfoTooltip
        content={
          <>
            <Trans>
              When enabled, an experiment&apos;s scheduled start/end are
              included as <code>metadata.startDate</code> and{" "}
              <code>metadata.endDate</code> on its experiment-ref rules in the
              SDK payload.
            </Trans>
          </>
        }
      />
    </>
  );
}

export function DraftRulesLabel() {
  const { i18n } = useLingui();
  return (
    <>
      {i18n._(SETTING_TITLES.draftRules)}{" "}
      <InfoTooltip
        content={
          <p>
            <Trans>
              When enabled, experiment-ref rules linked to draft experiments
              will be included in the SDK payload. We recommend only enabling
              this for non-production environments.
            </Trans>
          </p>
        }
      />
    </>
  );
}

export function DraftExperimentsLabel() {
  const { i18n } = useLingui();
  return (
    <>
      {i18n._(SETTING_TITLES.draftExperiments)}{" "}
      <InfoTooltip
        content={
          <>
            <p>
              <Trans>
                In-development auto experiments will be sent to the SDK. We
                recommend only enabling this for non-production environments.
              </Trans>
            </p>
            <p>
              <Trans>
                To force into a variation, use a URL query string such as{" "}
                <code>?my-experiment-key=2</code>
              </Trans>
            </p>
          </>
        }
      />
    </>
  );
}

export function ProxyHostTooltip() {
  return (
    <InfoTooltip
      content={
        <>
          <p>
            <Trans>
              Optionally add your proxy&apos;s public URL to enable faster
              rollouts. Providing your proxy host will allow GrowthBook to push
              updates to your proxy whenever feature definitions change.
            </Trans>
          </p>
          <p>
            <Trans>
              Without GrowthBook&apos;s push updates, the proxy will fall back
              to a stale-while-revalidate caching strategy.
            </Trans>
          </p>
        </>
      }
    />
  );
}

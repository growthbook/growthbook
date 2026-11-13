import { ReactNode } from "react";
import { PiInfo } from "react-icons/pi";
import { Box } from "@radix-ui/themes";
import { SavedGroupFormat } from "shared/types/sdk-connection";
import HelperText from "@/ui/HelperText";
import Tooltip from "@/ui/Tooltip";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { DocLink } from "@/components/DocLink";

export const CATEGORY_TITLES = {
  payloadSecurity: "Payload Security",
  experiments: "Experiments",
  savedGroups: "Saved Groups",
  payloadMetadata: "Payload Metadata",
  observability: "Observability and QA",
  proxy: "GrowthBook Proxy",
} as const;

export const DELIVERY_LABELS = {
  plain: "Plain Text",
  ciphered: "Ciphered",
  remote: "Remote Evaluated",
} as const;

export const SETTING_TITLES = {
  visualEditor: "Enable Visual Editor experiments",
  urlRedirect: "Enable URL Redirect experiments",
  hideNames: "Hide names from payload",
  savedGroupReferences: "Pass Saved Groups by reference",
  passByReference: "Pass by reference",
  prerequisites: "Always include prerequisite Feature Flags",
  remoteCipherOptions: "Advanced",
  // Under an "Include" label.
  includeMetadata: "Include",
  projectIds: "Project IDs",
  customFields: "Custom Fields",
  tags: "Tags",
  scheduleDates: "Experiment schedule dates",
  ruleIds: "Include feature rule IDs in payload",
  draftRules: "Include draft Experiment rules in feature definitions",
  draftExperiments: "Include draft Visual Editor and URL Redirect experiments",
  useProxy: "Use GrowthBook Proxy",
  proxyHost: "Proxy Host URL",
} as const;

export const SAVED_GROUP_FORMAT_LABELS: Record<SavedGroupFormat, string> = {
  inline: "Off",
  referencesV1: "ID Lists only",
  referencesV2: "All Saved Groups",
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
  return (
    <Tooltip content={content} {...SETTING_TIP}>
      <Box
        as="span"
        display="inline-block"
        tabIndex={0}
        aria-label="More information"
      >
        <PiInfo />
      </Box>
    </Tooltip>
  );
}

// Over the cipher options a remotely evaluated payload can still have.
export function RemoteCipherOptionsLabel() {
  return (
    <>
      {SETTING_TITLES.remoteCipherOptions}{" "}
      <InfoTooltip content="Rarely needed with remote evaluation, since the full payload never reaches the client." />
    </>
  );
}

export function VisualEditorLabel() {
  return (
    <>
      Enable <strong>Visual Editor</strong> experiments (
      <DocLink docSection="visual_editor">docs</DocLink>)
    </>
  );
}

export function UrlRedirectLabel() {
  return (
    <>
      Enable <strong>URL Redirect</strong> experiments (
      <DocLink docSection="url_redirects">docs</DocLink>)
    </>
  );
}

export function HideNamesLabel() {
  return (
    <>
      {SETTING_TITLES.hideNames}{" "}
      <InfoTooltip
        content={
          <>
            <p>
              Strips every <code>experiment.name</code> and per-variation{" "}
              <code>name</code> from the SDK payload. The SDK&apos;s{" "}
              <code>trackingCallback</code> still receives stable{" "}
              <code>key</code> / <code>variationId</code> values.
            </p>
            <p>
              Experiment and variation names can help add context when debugging
              or tracking events, but could expose potentially sensitive
              information to your users in a client-side or mobile application.
            </p>
            <p>
              For maximum privacy and security, we recommend hiding these
              fields.
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
  return (
    <PremiumTooltip
      commercialFeature="large-saved-groups"
      {...SETTING_PREMIUM_TIP}
      body={
        <>
          <p>
            Passing Saved Groups by reference sends each group once in its own
            key instead of copying it into every rule that uses it, so re-using
            a group stops growing the payload.
          </p>
          <HelperText status="warning" size="sm">
            Older SDK versions
            {remoteEvalEnabled
              ? " and remote evaluation tools (e.g. GrowthBook Proxy)"
              : ""}{" "}
            cannot read references. Check your SDK is up to date before changing
            this.
          </HelperText>
        </>
      }
    >
      <WithInfoIcon>{SETTING_TITLES.passByReference}</WithInfoIcon>
    </PremiumTooltip>
  );
}

export function PrerequisitesLabel() {
  return (
    <>
      {SETTING_TITLES.prerequisites}{" "}
      <InfoTooltip content="Deliver prerequisite Feature Flags that target other Projects. Without them, the Feature Flags they gate are always off. Only applies when this connection filters by Project." />
    </>
  );
}

export function ProjectIdsLabel() {
  return (
    <>
      {SETTING_TITLES.projectIds}{" "}
      <InfoTooltip
        content={
          <>
            <p>
              When enabled, each feature and experiment in the SDK payload will
              include a <code>metadata.projects</code> array containing the
              project&apos;s public ID (or internal ID if no public ID is set).
            </p>
            <p>
              Features and rules that target all projects omit the array by
              convention — treat a missing <code>metadata.projects</code> as
              &quot;all projects&quot;.
            </p>
          </>
        }
      />
    </>
  );
}

export function CustomFieldsLabel() {
  return (
    <>
      {SETTING_TITLES.customFields}{" "}
      <InfoTooltip
        content={
          <p>
            Select specific custom field values to include in the{" "}
            <code>metadata.customFields</code> object for each feature and
            experiment.
          </p>
        }
      />
    </>
  );
}

export function TagsLabel() {
  return (
    <>
      {SETTING_TITLES.tags}{" "}
      <InfoTooltip
        content={
          <>
            When enabled, all feature tags will be included in the{" "}
            <code>metadata.tags</code> array for each feature in the SDK
            payload.
          </>
        }
      />
    </>
  );
}

export function ScheduleDatesLabel() {
  return (
    <>
      {SETTING_TITLES.scheduleDates}{" "}
      <InfoTooltip
        content={
          <>
            When enabled, an experiment&apos;s scheduled start/end are included
            as <code>metadata.startDate</code> and <code>metadata.endDate</code>{" "}
            on its experiment-ref rules in the SDK payload.
          </>
        }
      />
    </>
  );
}

export function DraftRulesLabel() {
  return (
    <>
      {SETTING_TITLES.draftRules}{" "}
      <InfoTooltip
        content={
          <p>
            When enabled, experiment-ref rules linked to draft experiments will
            be included in the SDK payload. We recommend only enabling this for
            non-production environments.
          </p>
        }
      />
    </>
  );
}

export function DraftExperimentsLabel() {
  return (
    <>
      {SETTING_TITLES.draftExperiments}{" "}
      <InfoTooltip
        content={
          <>
            <p>
              In-development auto experiments will be sent to the SDK. We
              recommend only enabling this for non-production environments.
            </p>
            <p>
              To force into a variation, use a URL query string such as{" "}
              <code>?my-experiment-key=2</code>
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
            Optionally add your proxy&apos;s public URL to enable faster
            rollouts. Providing your proxy host will allow GrowthBook to push
            updates to your proxy whenever feature definitions change.
          </p>
          <p>
            Without GrowthBook&apos;s push updates, the proxy will fall back to
            a stale-while-revalidate caching strategy.
          </p>
        </>
      }
    />
  );
}

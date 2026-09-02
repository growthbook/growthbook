import { PiInfo } from "react-icons/pi";
import HelperText from "@/ui/HelperText";
import Tooltip from "@/components/Tooltip/Tooltip";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { DocLink } from "@/components/DocLink";

/**
 * The titles of every SDK connection settings category and setting, verbatim
 * from the full form, so they read the same on the detail page cards, in the
 * per-card editor and in the create/edit modals. The label components below
 * add the full form's help copy and docs links.
 */

export const CATEGORY_TITLES = {
  payloadSecurity: "Payload Security",
  experiments: "Experiments",
  savedGroups: "Saved Groups",
  payloadMetadata: "Payload Metadata",
  observability: "Observability and QA",
  proxy: "GrowthBook Proxy",
} as const;

export type SDKConnectionSettingsCategory = keyof typeof CATEGORY_TITLES;

export const SETTING_TITLES = {
  visualEditor: "Enable Visual Editor experiments",
  urlRedirect: "Enable URL Redirect experiments",
  hideNames: "Hide names from payload",
  savedGroupReferences: "Pass Saved Groups by reference",
  projectIds: "Include Project IDs",
  customFields: "Include Custom Fields",
  tags: "Include tags",
  scheduleDates: "Include experiment schedule dates",
  ruleIds: "Include feature rule IDs in payload",
  draftRules: "Include draft Experiment rules in feature definitions",
  draftExperiments: "Include draft Visual Editor and URL Redirect experiments",
  useProxy: "Use GrowthBook Proxy",
  proxyHost: "Proxy Host URL",
} as const;

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
      <Tooltip
        body={
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
      >
        <PiInfo />
      </Tooltip>
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
      body={
        <>
          <p>
            Reduce the size of your payload by moving ID List Saved Groups from
            inline evaluation to a separate key in the payload json. Re-using an
            ID List in multiple features or experiments will no longer
            meaningfully increase the size of your payload.
          </p>
          <HelperText status="warning" size="sm">
            This feature is not supported by old SDK versions
            {remoteEvalEnabled
              ? " or remote evaluation tools (e.g. GrowthBook Proxy)"
              : ""}
            . Ensure that your SDK implementation is up to date before enabling
            this feature.
          </HelperText>
        </>
      }
    >
      {SETTING_TITLES.savedGroupReferences} <PiInfo />
    </PremiumTooltip>
  );
}

export function ProjectIdsLabel() {
  return (
    <>
      {SETTING_TITLES.projectIds}{" "}
      <Tooltip
        body={
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
      >
        <PiInfo />
      </Tooltip>
    </>
  );
}

export function CustomFieldsLabel() {
  return (
    <>
      {SETTING_TITLES.customFields}{" "}
      <Tooltip
        body={
          <p>
            Select specific custom field values to include in the{" "}
            <code>metadata.customFields</code> object for each feature and
            experiment.
          </p>
        }
      >
        <PiInfo />
      </Tooltip>
    </>
  );
}

export function TagsLabel() {
  return (
    <>
      {SETTING_TITLES.tags}{" "}
      <Tooltip
        body={
          <>
            When enabled, all feature tags will be included in the{" "}
            <code>metadata.tags</code> array for each feature in the SDK
            payload.
          </>
        }
      >
        <PiInfo />
      </Tooltip>
    </>
  );
}

export function ScheduleDatesLabel() {
  return (
    <>
      {SETTING_TITLES.scheduleDates}{" "}
      <Tooltip
        body={
          <>
            When enabled, an experiment&apos;s scheduled start/end are included
            as <code>metadata.startDate</code> and <code>metadata.endDate</code>{" "}
            on its experiment-ref rules in the SDK payload.
          </>
        }
      >
        <PiInfo />
      </Tooltip>
    </>
  );
}

export function DraftRulesLabel() {
  return (
    <>
      {SETTING_TITLES.draftRules}{" "}
      <Tooltip
        body={
          <p>
            When enabled, experiment-ref rules linked to draft experiments will
            be included in the SDK payload. We recommend only enabling this for
            non-production environments.
          </p>
        }
      >
        <PiInfo />
      </Tooltip>
    </>
  );
}

export function DraftExperimentsLabel() {
  return (
    <>
      {SETTING_TITLES.draftExperiments}{" "}
      <Tooltip
        body={
          <>
            <p>
              In-development auto experiments will be sent to the SDK. We
              recommend only enabling this for non-production environments.
            </p>
            <p>
              To force into a variation, use a URL query string such as{" "}
              <code style={{ display: "block" }}>?my-experiment-key=2</code>
            </p>
          </>
        }
      >
        <PiInfo />
      </Tooltip>
    </>
  );
}

export function ProxyHostTooltip() {
  return (
    <Tooltip
      body={
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
    >
      <PiInfo />
    </Tooltip>
  );
}

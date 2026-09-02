import { PiInfo } from "react-icons/pi";
import HelperText from "@/ui/HelperText";
import Tooltip from "@/components/Tooltip/Tooltip";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { DocLink } from "@/components/DocLink";

/**
 * The label (and help copy) of every advanced SDK connection setting, verbatim
 * from the full form, so a setting reads the same wherever it's edited.
 */

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
      Hide names from payload{" "}
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
      Pass Saved Groups by reference <PiInfo />
    </PremiumTooltip>
  );
}

export function ProjectIdsLabel() {
  return (
    <>
      Include Project IDs{" "}
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
      Include Custom Fields{" "}
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
      Include tags{" "}
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
      Include experiment schedule dates{" "}
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

export const RULE_IDS_LABEL = "Include feature rule IDs in payload";

export function DraftRulesLabel() {
  return (
    <>
      Include draft Experiment rules in feature definitions{" "}
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
      Include draft Visual Editor and URL Redirect experiments{" "}
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

export const USE_PROXY_LABEL = "Use GrowthBook Proxy";

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

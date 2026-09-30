import { Fragment } from "react";
import { Box } from "@radix-ui/themes";
import { getMetricLink } from "shared/experiments";
import { PiWarningFill } from "react-icons/pi";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Metadata from "@/ui/Metadata";
import Tooltip from "@/ui/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";

export function ReplacedByCallout({ metricId }: { metricId: string }) {
  const { _factMetricsIncludingArchived } = useDefinitions();

  const replacements = _factMetricsIncludingArchived.filter((m) =>
    m.replaces?.includes(metricId),
  );
  if (!replacements.length) return null;

  return (
    <Callout status="info" mb="2">
      <strong>This metric has been replaced.</strong> Prefer{" "}
      {replacements.map((m, i) => (
        <Fragment key={m.id}>
          {i > 0 ? ", " : ""}
          <Link href={getMetricLink(m.id)}>{m.name}</Link>
        </Fragment>
      ))}{" "}
      in new experiments.
    </Callout>
  );
}

export function ReplacesMetadata({ replaces }: { replaces?: string[] }) {
  const { getExperimentMetricById } = useDefinitions();

  if (!replaces?.length) return null;

  return (
    <Metadata
      label="Replaces"
      value={
        <>
          {replaces.map((id, i) => {
            const metric = getExperimentMetricById(id);
            return (
              <Fragment key={id}>
                {i > 0 ? <span>,&nbsp;</span> : null}
                {metric ? (
                  <Link href={getMetricLink(id)}>{metric.name}</Link>
                ) : (
                  <em>{id}</em>
                )}
              </Fragment>
            );
          })}
        </>
      }
    />
  );
}

export function ReplacedMetricWarning({ name }: { name: string }) {
  const label = `Replaced by “${name}”. Showing the previous metric’s results until results are refreshed.`;
  return (
    <Tooltip content={label}>
      <Box
        as="span"
        display="inline-block"
        ml="1"
        tabIndex={0}
        aria-label={label}
      >
        <PiWarningFill
          size={14}
          aria-hidden
          style={{ color: "var(--amber-11)", verticalAlign: "-0.15em" }}
        />
      </Box>
    </Tooltip>
  );
}

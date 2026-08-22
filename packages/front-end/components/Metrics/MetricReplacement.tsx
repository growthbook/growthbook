import { Fragment } from "react";
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
      <strong>
        This metric has been replaced by{" "}
        {replacements.map((m, i) => (
          <Fragment key={m.id}>
            {i > 0 ? ", " : ""}
            <Link href={getMetricLink(m.id)}>{m.name}</Link>
          </Fragment>
        ))}
        .
      </strong>{" "}
      Prefer the newer metric in new experiments.
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
  return (
    <Tooltip
      content={`Replaced by “${name}”. Showing the previous metric’s results until results are refreshed.`}
    >
      <PiWarningFill
        size={14}
        style={{
          color: "var(--amber-11)",
          marginLeft: 4,
          verticalAlign: "-0.15em",
        }}
      />
    </Tooltip>
  );
}

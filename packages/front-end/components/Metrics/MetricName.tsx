import { HiBadgeCheck } from "react-icons/hi";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "../Tooltip/Tooltip";

export function OfficialBadge({
  type,
  managedBy,
}: {
  type: string;
  managedBy?: "" | "config" | "api";
}) {
  if (!managedBy) return null;

  return (
    <span className="ml-1 text-purple">
      <Tooltip
        body={
          <>
            This is an <strong>Official</strong> {type} and is managed by{" "}
            {managedBy === "config" ? (
              <>
                the <code>config.yml</code> file
              </>
            ) : (
              <>the API</>
            )}
            . It cannot be edited within the GrowthBook UI.
          </>
        }
      >
        <HiBadgeCheck style={{ fontSize: "1.2em", lineHeight: "1em" }} />
      </Tooltip>
    </span>
  );
}

export default function MetricName({ id }: { id: string }) {
  const { getExperimentMetricById } = useDefinitions();
  const metric = getExperimentMetricById(id);

  if (!metric) return <>id</>;

  return (
    <>
      {metric.name}
      <OfficialBadge type="metric" managedBy={metric.managedBy} />
    </>
  );
}

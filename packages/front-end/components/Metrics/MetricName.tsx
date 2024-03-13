import { HiBadgeCheck } from "react-icons/hi";
import { useDefinitions } from "@front-end/services/DefinitionsContext";
import Tooltip from "@front-end/components/Tooltip/Tooltip";

export function OfficialBadge({
  type,
  managedBy,
  disableTooltip,
  showOfficialLabel,
}: {
  type: string;
  managedBy?: "" | "config" | "api";
  disableTooltip?: boolean;
  showOfficialLabel?: boolean;
}) {
  if (!managedBy) return null;

  return (
    <span className="ml-1 text-purple">
      <Tooltip
        body={
          disableTooltip ? (
            ""
          ) : (
            <>
              <h4>
                <HiBadgeCheck
                  style={{
                    fontSize: "1.2em",
                    lineHeight: "1em",
                    marginTop: "-2px",
                  }}
                  className="text-purple"
                />{" "}
                Official{" "}
                <span
                  style={{
                    textTransform: "capitalize",
                  }}
                >
                  {type}
                </span>
              </h4>
              This {type} is being managed by{" "}
              {managedBy === "config" ? (
                <>
                  a <code>config.yml</code> file
                </>
              ) : (
                <>the API</>
              )}
              . It is read-only and cannot be modified from within GrowthBook.
            </>
          )
        }
      >
        <HiBadgeCheck
          style={{ fontSize: "1.2em", lineHeight: "1em", marginTop: "-2px" }}
        />
        {showOfficialLabel ? (
          <span className="ml-1 badge badge-purple">Official</span>
        ) : null}
      </Tooltip>
    </span>
  );
}

export default function MetricName({
  id,
  disableTooltip,
  showOfficialLabel,
}: {
  id: string;
  disableTooltip?: boolean;
  showOfficialLabel?: boolean;
}) {
  const { getExperimentMetricById } = useDefinitions();
  const metric = getExperimentMetricById(id);

  if (!metric) return <>{id}</>;

  return (
    <>
      {metric.name}
      <OfficialBadge
        type="metric"
        managedBy={metric.managedBy}
        disableTooltip={disableTooltip}
        showOfficialLabel={showOfficialLabel}
      />
    </>
  );
}

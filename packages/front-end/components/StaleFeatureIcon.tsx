import { StaleFeatureReason } from "shared/util";
import { FeatureInterface } from "shared/types/feature";
import { BsStopwatch } from "react-icons/bs";
import Tooltip from "@/components/Tooltip/Tooltip";
import styles from "./StaleFeatureIcon.module.scss";

const staleReasonToMessageMap: Record<StaleFeatureReason, string> = {
  "never-stale": "Stale detection is disabled for this feature.",
  "recently-updated": "Feature was updated within the last two weeks.",
  "active-draft": "Feature has an active draft in progress.",
  "has-dependents":
    "Feature is used by a non-stale dependent feature or experiment.",
  "no-rules": "No rules have been defined for this feature.",
  "rules-one-sided": "All rules are one-sided.",
  "abandoned-draft": "Open draft has not been updated in over a month.",
  "toggled-off": "Environment is disabled.",
  error: "An error occurred while evaluating staleness.",
};

function EnvBreakdown({
  staleByEnv,
}: {
  staleByEnv: FeatureInterface["staleByEnv"];
}) {
  if (!staleByEnv) return null;
  const entries = Object.entries(staleByEnv);
  if (!entries.length) return null;
  return (
    <table style={{ marginTop: 6, width: "100%", borderCollapse: "collapse" }}>
      <tbody>
        {entries.map(([envId, info]) => (
          <tr key={envId}>
            <td style={{ paddingRight: 8, fontWeight: 600 }}>{envId}</td>
            <td style={{ paddingRight: 8 }}>
              {info.isStale ? (
                <span style={{ color: "#f8c200" }}>stale</span>
              ) : (
                <span style={{ opacity: 0.7 }}>ok</span>
              )}
            </td>
            <td style={{ paddingRight: 8, opacity: 0.8 }}>
              {info.reason && info.reason !== "toggled-off"
                ? (staleReasonToMessageMap[info.reason as StaleFeatureReason] ??
                  info.reason)
                : null}
            </td>
            {info.evaluatesTo !== undefined ? (
              <td style={{ fontFamily: "monospace", opacity: 0.8 }}>
                {JSON.stringify(info.evaluatesTo)}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function StaleFeatureIcon({
  staleReason,
  staleByEnv,
  onClick,
}: {
  staleReason: StaleFeatureReason | undefined;
  staleByEnv?: FeatureInterface["staleByEnv"];
  onClick: () => void;
}) {
  const body = (
    <div>
      <div>
        This feature has been marked stale.{" "}
        {(staleReason && staleReasonToMessageMap[staleReason]) ?? ""}
      </div>
      <EnvBreakdown staleByEnv={staleByEnv} />
    </div>
  );

  return (
    <Tooltip popperClassName="text-left" body={body}>
      <BsStopwatch size={18} onClick={onClick} className={styles.staleIcon} />
    </Tooltip>
  );
}

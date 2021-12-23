import { FeatureValueType, RolloutValue } from "back-end/types/feature";
import ValueDisplay from "./ValueDisplay";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function RolloutSummary({
  rollout,
  type,
  hashAttribute,
  trackingKey,
}: {
  rollout: RolloutValue[];
  type: FeatureValueType;
  hashAttribute: string;
  trackingKey: string;
}) {
  const totalPercent = rollout.reduce((sum, w) => sum + w.weight, 0);

  return (
    <div>
      <div className="mb-3">
        <strong>SPLIT</strong> users by{" "}
        <span className="mr-1 border px-2 py-1 bg-light rounded">
          {hashAttribute}
        </span>
      </div>
      <strong>SERVE</strong>
      <table className="table mt-1 mb-3 ml-3 w-auto">
        <tbody>
          {rollout.map((r, j) => (
            <tr key={j}>
              <td>
                <ValueDisplay value={r.value} type={type} />
              </td>
              <td>
                <div className="d-flex">
                  <div style={{ width: "4em", maxWidth: "4em" }}>
                    {percentFormatter.format(r.weight)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      className="progress d-none d-md-flex"
                      style={{ minWidth: 150 }}
                    >
                      <div
                        className="progress-bar bg-info"
                        style={{
                          width: r.weight * 100 + "%",
                        }}
                      />
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          ))}
          {totalPercent < 1 && (
            <tr>
              <td>
                <em className="text-muted">unallocated, skip rule</em>
              </td>
              <td>
                <div className="d-flex">
                  <div style={{ width: "4em", maxWidth: "4em" }}>
                    {percentFormatter.format(1 - totalPercent)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="progress">
                      <div
                        className="progress-bar"
                        style={{
                          width: (1 - totalPercent) * 100 + "%",
                          backgroundColor: "#ccc",
                        }}
                      />
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div>
        <strong>TRACK</strong> the split with the key{" "}
        <span className="mr-1 border px-2 py-1 bg-light rounded">
          {trackingKey}
        </span>
      </div>
    </div>
  );
}

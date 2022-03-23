import { Namespaces, NamespaceUsage } from "back-end/types/organization";
import Link from "next/link";
import { useState } from "react";
import { findGaps } from "../../services/features";
import NamespaceUsageGraph from "../Features/NamespaceUsageGraph";

export interface Props {
  usage: NamespaceUsage;
  namespace: Namespaces;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function NamespaceTableRow({ usage, namespace }: Props) {
  const experiments = usage[namespace.name] ?? [];

  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<[number, number] | null>(null);

  return (
    <>
      <tr
        style={{ cursor: "pointer" }}
        onClick={(e) => {
          e.preventDefault();
          setOpen(!open);
        }}
      >
        <td>{namespace.name}</td>
        <td>{namespace.description}</td>
        <td>{experiments.length}</td>
        <td>
          {percentFormatter.format(
            findGaps(usage, namespace.name).reduce(
              (sum, range) => sum + (range.end - range.start),
              0
            )
          )}
        </td>
      </tr>
      <tr
        className="bg-white"
        style={{
          display: open ? "" : "none",
        }}
      >
        <td
          colSpan={4}
          className="px-4 bg-light"
          style={{
            boxShadow: "rgba(0, 0, 0, 0.06) 0px 2px 4px 0px inset",
          }}
        >
          <NamespaceUsageGraph
            namespace={namespace.name}
            usage={usage}
            title={"Namespace Usage"}
            range={range}
          />
          {experiments.length > 0 ? (
            <div>
              <table
                className="table gb-table table-hover"
                onMouseOut={() => {
                  setRange(null);
                }}
              >
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>Environment</th>
                    <th>Experiment Key</th>
                    <th>Range</th>
                  </tr>
                </thead>
                <tbody>
                  {experiments.map((e, i) => {
                    return (
                      <tr
                        key={i}
                        onMouseOver={() => {
                          setRange([e.start, e.end]);
                        }}
                      >
                        <td>
                          <Link href={`/features/${e.featureId}`}>
                            <a>{e.featureId}</a>
                          </Link>
                        </td>
                        <td>{e.environment}</td>
                        <td>{e.trackingKey || e.featureId}</td>
                        <td>
                          {e.start} to {e.end}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <em>No active experiments are using this namespace</em>
          )}
        </td>
      </tr>
    </>
  );
}

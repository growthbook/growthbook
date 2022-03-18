import { Namespaces, NamespaceUsage } from "back-end/types/organization";
import Link from "next/link";
import { useState } from "react";
import { FaAngleRight } from "react-icons/fa";
import { findGaps, Ranges } from "../../services/features";
import NamespaceUsageGraph from "../Features/NamespaceUsageGraph";

export interface Props {
  usage: NamespaceUsage;
  namespace: Namespaces;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

function getPercentRemaining(ranges: Ranges) {
  return findGaps(ranges).reduce(
    (sum, range) => sum + (range.end - range.start),
    0
  );
}

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
            getPercentRemaining(
              experiments.map(({ start, end }) => ({
                start,
                end,
              }))
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
              Active Experiments:
              <ul
                onMouseOut={() => {
                  setRange(null);
                }}
              >
                {experiments.map((e, i) => {
                  return (
                    <li key={i} className="my-2">
                      <Link href={`/features/${e.featureId}`}>
                        <a
                          onMouseOver={() => {
                            setRange([e.start, e.end]);
                          }}
                        >
                          {e.featureId} <FaAngleRight /> {e.environment}{" "}
                          {e.trackingKey !== e.featureId && (
                            <>
                              <FaAngleRight /> {e.trackingKey}
                            </>
                          )}
                        </a>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <em>No active experiments are using this namespace</em>
          )}
        </td>
      </tr>
    </>
  );
}

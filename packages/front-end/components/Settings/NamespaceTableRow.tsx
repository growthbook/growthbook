import { Namespaces, NamespaceUsage } from "back-end/types/organization";
import Link from "next/link";
import { MouseEventHandler, useState } from "react";
import { findGaps } from "@/services/features";
import usePermissions from "@/hooks/usePermissions";
import NamespaceUsageGraph from "../Features/NamespaceUsageGraph";
import DeleteButton from "../DeleteButton/DeleteButton";
import MoreMenu from "../Dropdown/MoreMenu";

export interface Props {
  i: number;
  usage: NamespaceUsage;
  namespace: Namespaces;
  onDelete: () => Promise<void>;
  onArchive: () => Promise<void>;
  onEdit: () => void;
}

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function NamespaceTableRow({
  usage,
  namespace,
  onDelete,
  onArchive,
  onEdit,
}: Props) {
  const experiments = usage[namespace.name] ?? [];
  const permissions = usePermissions();
  const canEdit = permissions.manageNamespaces;

  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<[number, number] | null>(null);

  const status = namespace?.status || "active";

  const expandRow: MouseEventHandler = (e) => {
    e.preventDefault();
    setOpen(!open);
  };

  return (
    <>
      <tr
        className={`${status === "inactive" ? "text-muted" : ""}`}
        style={{ cursor: "pointer" }}
      >
        <td onClick={expandRow}>
          {namespace.name}
          {status === "inactive" && (
            <div
              className={`badge badge-secondary ml-2`}
              style={{ fontSize: "0.9em" }}
              title="This namespace is hidden and cannot be used for new experiments"
            >
              Disabled
            </div>
          )}
        </td>
        <td onClick={expandRow}>{namespace.description}</td>
        <td onClick={expandRow}>{experiments.length}</td>
        <td onClick={expandRow}>
          {percentFormatter.format(
            findGaps(usage, namespace.name).reduce(
              (sum, range) => sum + (range.end - range.start),
              0
            )
          )}
        </td>
        {canEdit && (
          <td>
            <MoreMenu>
              <a
                href="#"
                className="dropdown-item"
                onClick={(e) => {
                  e.preventDefault();
                  onEdit();
                }}
              >
                edit
              </a>
              <a
                href="#"
                className="dropdown-item"
                onClick={async (e) => {
                  e.preventDefault();
                  await onArchive();
                }}
              >
                {namespace?.status === "inactive" ? "enable" : "disable"}
              </a>
              {experiments.length === 0 && (
                <DeleteButton
                  displayName="Namespace"
                  className="dropdown-item text-danger"
                  useIcon={false}
                  text="delete"
                  title="Delete Namespace"
                  onClick={onDelete}
                />
              )}
            </MoreMenu>
          </td>
        )}
      </tr>
      <tr
        className="bg-white"
        style={{
          display: open ? "" : "none",
        }}
      >
        <td
          colSpan={canEdit ? 5 : 4}
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

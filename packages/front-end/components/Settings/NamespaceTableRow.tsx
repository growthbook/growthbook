import { Namespaces, NamespaceUsage } from "shared/types/organization";
import Link from "next/link";
import { MouseEventHandler, useState } from "react";
import { findGaps } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import NamespaceUsageGraph from "@/components/Features/NamespaceUsageGraph";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";

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
  const permissionsUtil = usePermissionsUtil();
  const canEdit = permissionsUtil.canUpdateNamespace();
  const canDelete = permissionsUtil.canDeleteNamespace();

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
          {namespace.label}
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
        <td onClick={expandRow} className="text-muted small">
          {namespace.name}
        </td>
        <td onClick={expandRow}>{namespace.description}</td>
        <td onClick={expandRow}>{experiments.length}</td>
        <td onClick={expandRow}>
          {percentFormatter.format(
            findGaps(usage, namespace.name).reduce(
              (sum, range) => sum + (range.end - range.start),
              0,
            ),
          )}
        </td>
        <td>
          <MoreMenu>
            {canEdit ? (
              <>
                <a
                  href="#"
                  className="dropdown-item"
                  onClick={(e) => {
                    e.preventDefault();
                    onEdit();
                  }}
                >
                  Edit
                </a>
                <a
                  href="#"
                  className="dropdown-item"
                  onClick={async (e) => {
                    e.preventDefault();
                    await onArchive();
                  }}
                >
                  {namespace?.status === "inactive" ? "Enable" : "Disable"}
                </a>
              </>
            ) : null}
            {experiments.length === 0 && canDelete ? (
              <DeleteButton
                displayName="Namespace"
                className="dropdown-item text-danger"
                useIcon={false}
                text="Delete"
                title="Delete Namespace"
                onClick={onDelete}
              />
            ) : null}
          </MoreMenu>
        </td>
      </tr>
      <tr
        className="appbox"
        style={{
          display: open ? "" : "none",
        }}
      >
        <td
          colSpan={6}
          className="px-4"
          style={{
            boxShadow: "rgba(0, 0, 0, 0.06) 0px 2px 4px 0px inset",
          }}
        >
          <NamespaceUsageGraph
            namespace={namespace.name}
            usage={usage}
            title={"Namespace Usage"}
            // @ts-expect-error TS(2322) If you come across this, please fix it!: Type '[number, number] | null' is not assignable t... Remove this comment to see the full error message
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
                    <th>Feature / Experiment</th>
                    <th>Environment</th>
                    <th>Tracking Key</th>
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
                          <Link href={e.link}>{e.name}</Link>
                        </td>
                        <td>{e.environment}</td>
                        <td>{e.trackingKey || e.id}</td>
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

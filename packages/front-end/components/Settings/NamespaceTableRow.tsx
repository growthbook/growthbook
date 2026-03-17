import { Box } from "@radix-ui/themes";
import { Namespaces, NamespaceUsage } from "shared/types/organization";
import Link from "next/link";
import { MouseEventHandler, useState } from "react";
import { findGaps } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import NamespaceUsageGraph from "@/components/Features/NamespaceUsageGraph";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { TableRow, TableCell } from "@/ui/Table";

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
      <TableRow
        style={{
          cursor: "pointer",
          color: status === "inactive" ? "var(--gray-11)" : undefined,
        }}
      >
        <TableCell onClick={expandRow}>
          {namespace.label}
          {status === "inactive" && (
            <Box
              as="span"
              ml="2"
              style={{
                fontSize: "0.9em",
                padding: "2px 6px",
                backgroundColor: "var(--gray-a4)",
                borderRadius: "var(--radius-1)",
                color: "var(--gray-11)",
              }}
              title="This namespace is hidden and cannot be used for new experiments"
            >
              Disabled
            </Box>
          )}
        </TableCell>
        <TableCell
          onClick={expandRow}
          style={{
            color: "var(--gray-11)",
            fontSize: "var(--font-size-1)",
          }}
        >
          {namespace.name}
        </TableCell>
        <TableCell onClick={expandRow}>{namespace.description}</TableCell>
        <TableCell onClick={expandRow}>{experiments.length}</TableCell>
        <TableCell onClick={expandRow}>
          {percentFormatter.format(
            findGaps(usage, namespace.name).reduce(
              (sum, range) => sum + (range.end - range.start),
              0,
            ),
          )}
        </TableCell>
        <TableCell>
          <MoreMenu>
            {canEdit ? (
              <>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    onEdit();
                  }}
                >
                  Edit
                </a>
                <a
                  href="#"
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
                useIcon={false}
                text="Delete"
                title="Delete Namespace"
                onClick={onDelete}
              />
            ) : null}
          </MoreMenu>
        </TableCell>
      </TableRow>
      <TableRow
        className="appbox"
        style={{
          display: open ? "" : "none",
        }}
      >
        <TableCell
          colSpan={6}
          style={{
            padding: "var(--space-4)",
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
        </TableCell>
      </TableRow>
    </>
  );
}

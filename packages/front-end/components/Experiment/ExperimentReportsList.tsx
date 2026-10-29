import { useEffect, useMemo, useState } from "react";
import { ReportInterface } from "shared/types/report";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { date, datetime } from "shared/dates";
import { Box, Flex } from "@radix-ui/themes";
import { PiWarningFill } from "react-icons/pi";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useSearch } from "@/services/search";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ShareStatusBadge from "@/components/Report/ShareStatusBadge";
import Link from "@/ui/Link";
import Pagination from "@/ui/Pagination";
import TextField from "@/ui/TextField";
import Tooltip from "@/ui/Tooltip";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  MoreMenuTrigger,
} from "@/ui/DropdownMenu";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

const PER_PAGE = 10;

type ReportRow = {
  id: string;
  title: string;
  description: string;
  status: "public" | "organization" | "private";
  dateUpdated: Date;
  owner: string;
  report: ReportInterface;
  isOwner: boolean;
  canDelete: boolean;
};

export default function ExperimentReportsList({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const { userId, users } = useUser();

  const { data, mutate } = useApi<{
    reports: ReportInterface[];
  }>(`/experiment/${experiment.id}/reports`);

  const isAdmin = permissionsUtil.canSuperDeleteReport();
  const rows = useMemo<ReportRow[]>(
    () =>
      (data?.reports ?? []).flatMap((report) => {
        const isOwner = userId === report.userId || !report.userId;
        const shown =
          isOwner ||
          (report.type === "experiment"
            ? report.status === "published"
            : report.shareLevel === "public" ||
              report.shareLevel === "organization");
        if (!shown) return [];
        const status =
          report.type === "experiment"
            ? report.status === "private"
              ? "private"
              : "organization"
            : report.shareLevel === "public"
              ? "public"
              : report.shareLevel === "private"
                ? "private"
                : "organization";
        return [
          {
            id: report.id,
            title: report.title,
            description: report.description ?? "",
            status,
            dateUpdated: report.dateUpdated,
            owner: (report.userId && users.get(report.userId)?.name) || "",
            report,
            isOwner,
            canDelete:
              report.type === "experiment" ? isAdmin : isOwner || isAdmin,
          },
        ];
      }),
    [data, userId, users, isAdmin],
  );

  const { items, searchInputProps, SortableTableColumnHeader } = useSearch({
    items: rows,
    searchFields: ["title^3", "description", "owner"],
    localStorageKey: "experiment-reports",
    defaultSortField: "dateUpdated",
    defaultSortDir: -1,
    // The page's own search owns the URL.
    disableUrlSearchTerm: true,
  });

  // Paged here: useSearch's own pagination is the legacy control.
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [items.length]);
  const shown = items.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  if (!experiment.datasource || !rows.length) return null;

  return (
    <Box px="4" pb="4">
      <Box mb="3" style={{ maxWidth: 320 }}>
        <TextField
          type="search"
          placeholder="Search..."
          aria-label="Search Custom Reports"
          {...searchInputProps}
        />
      </Box>
      <Table variant="list" roundedCorners>
        <TableHeader>
          <TableRow>
            <SortableTableColumnHeader field="title">
              Title
            </SortableTableColumnHeader>
            <TableColumnHeader>Description</TableColumnHeader>
            <SortableTableColumnHeader field="status">
              Status
            </SortableTableColumnHeader>
            <SortableTableColumnHeader field="dateUpdated">
              Last updated
            </SortableTableColumnHeader>
            <SortableTableColumnHeader field="owner">
              By
            </SortableTableColumnHeader>
            <TableColumnHeader style={{ width: 50 }} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((row) => (
            <TableRow key={row.id}>
              <TableCell style={{ padding: "var(--space-0)" }}>
                <Link
                  href={`/report/${row.id}`}
                  style={{
                    padding: "var(--space-3)",
                    display: "block",
                    color: "var(--color-text-high)",
                  }}
                >
                  <Flex align="center" gap="2">
                    {row.report.type === "experiment" && row.report.error ? (
                      <Tooltip content={row.report.error}>
                        <Flex
                          role="img"
                          aria-label={`Failed: ${row.report.error}`}
                          style={{ color: "var(--red-11)" }}
                        >
                          <PiWarningFill />
                        </Flex>
                      </Tooltip>
                    ) : null}
                    {row.title}
                  </Flex>
                </Link>
              </TableCell>
              <TableCell>{row.description}</TableCell>
              <TableCell>
                <ShareStatusBadge
                  shareLevel={row.status}
                  editLevel={
                    row.report.type === "experiment-snapshot"
                      ? row.report.editLevel
                      : "organization"
                  }
                  isOwner={row.isOwner}
                />
              </TableCell>
              <TableCell>
                <Tooltip content={datetime(row.dateUpdated)}>
                  <span>{date(row.dateUpdated)}</span>
                </Tooltip>
              </TableCell>
              <TableCell>{row.owner}</TableCell>
              <TableCell>
                {row.canDelete ? (
                  <ReportActions
                    onDelete={async () => {
                      await apiCall(`/report/${row.id}`, { method: "DELETE" });
                      mutate();
                    }}
                  />
                ) : null}
              </TableCell>
            </TableRow>
          ))}
          {!items.length ? (
            <TableRow>
              <TableCell colSpan={6} style={{ textAlign: "center" }}>
                No custom reports match
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
      {items.length > PER_PAGE ? (
        <Pagination
          numItemsTotal={items.length}
          currentPage={page}
          perPage={PER_PAGE}
          onPageChange={setPage}
        />
      ) : null}
    </Box>
  );
}

function ReportActions({ onDelete }: { onDelete: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu
      trigger={<MoreMenuTrigger label="Custom Report actions" />}
      open={open}
      onOpenChange={setOpen}
      menuPlacement="end"
      variant="soft"
    >
      <DropdownMenuGroup>
        <DropdownMenuItem
          color="red"
          confirmation={{
            confirmationTitle: "Delete Custom Report",
            cta: "Delete",
            submit: onDelete,
            closeDropdown: () => setOpen(false),
          }}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenu>
  );
}

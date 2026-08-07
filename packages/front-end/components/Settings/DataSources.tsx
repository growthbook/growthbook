import React, { FC } from "react";
import { useRouter } from "next/router";
import { FaExclamationTriangle } from "react-icons/fa";
import { ago } from "shared/dates";
import { isProjectListValidForProject } from "shared/util";
import Link from "@/ui/Link";
import ProjectBadges from "@/components/ProjectBadges";
import { hasFileConfig } from "@/services/env";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import Callout from "@/ui/Callout";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
  TableRowHeaderCell,
} from "@/ui/Table";

const DataSources: FC = () => {
  const router = useRouter();

  const { datasources, project, error, ready } = useDefinitions();
  const filteredDatasources = project
    ? datasources.filter((ds) =>
        isProjectListValidForProject(ds.projects, project),
      )
    : datasources;

  if (error) {
    return <Callout status="error">{error}</Callout>;
  }
  if (!ready) {
    return <LoadingOverlay />;
  }

  return (
    <Table variant="list">
      <TableHeader>
        <TableRow>
          <TableColumnHeader style={{ width: "16.67%" }}>
            Display Name
          </TableColumnHeader>
          <TableColumnHeader>Description</TableColumnHeader>
          <TableColumnHeader style={{ width: "16.67%" }}>
            Type
          </TableColumnHeader>
          <TableColumnHeader style={{ width: "16.67%" }}>
            Projects
          </TableColumnHeader>
          {!hasFileConfig() && (
            <TableColumnHeader style={{ width: "16.67%" }}>
              Last Updated
            </TableColumnHeader>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {filteredDatasources.map((d, i) => (
          <TableRow
            className="cursor-pointer"
            key={i}
            onClick={(e) => {
              // If clicking on a link or button, default to browser behavior
              if (
                e.target instanceof HTMLElement &&
                e.target.closest("a, button")
              ) {
                return;
              }

              // If cmd/ctrl/shift+click, open in new tab
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
                window.open(`/datasources/${d.id}`, "_blank");
                return;
              }

              // Otherwise, navigate to the data source
              e.preventDefault();
              router.push(`/datasources/${d.id}`);
            }}
          >
            <TableRowHeaderCell>
              <Link href={`/datasources/${d.id}`}>{d.name}</Link>{" "}
              {d.decryptionError && (
                <Tooltip
                  body={
                    <>
                      Could not decrypt the connection settings for this data
                      source. Click on the data source name for more info.
                    </>
                  }
                >
                  <FaExclamationTriangle className="text-danger" />
                </Tooltip>
              )}
            </TableRowHeaderCell>
            <TableCell
              style={{
                paddingRight: "var(--space-5)",
                color: "var(--color-text-low)",
                fontSize: 12,
              }}
            >
              {d.description}
            </TableCell>
            <TableCell>{d.type}</TableCell>
            <TableCell>
              {(d?.projects?.length || 0) > 0 ? (
                <ProjectBadges
                  resourceType="data source"
                  projectIds={d.projects}
                />
              ) : (
                <ProjectBadges resourceType="data source" />
              )}
            </TableCell>
            {!hasFileConfig() && (
              <TableCell>{ago(d.dateUpdated || "")}</TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export default DataSources;

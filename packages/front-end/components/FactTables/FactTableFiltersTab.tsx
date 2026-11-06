import { FactTableInterface } from "shared/types/fact-table";
import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import InlineCode from "@/components/SyntaxHighlighting/InlineCode";
import { OfficialBadge } from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import FactFilterModal from "./FactFilterModal";
import styles from "./FactTableDetailsPage.module.scss";

export default function FactTableFiltersTab({
  factTable,
}: {
  factTable: FactTableInterface;
}) {
  const [editOpen, setEditOpen] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const permissionsUtil = usePermissionsUtil();
  const canAddAndEdit = permissionsUtil.canCreateAndUpdateFactFilter(factTable);
  const canDelete = permissionsUtil.canDeleteFactFilter(factTable);

  const filters = [...factTable.filters].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <div className={styles.frame}>
      {newOpen && (
        <FactFilterModal
          close={() => setNewOpen(false)}
          factTable={factTable}
        />
      )}
      {editOpen && (
        <FactFilterModal
          close={() => setEditOpen("")}
          factTable={factTable}
          existing={factTable.filters.find((f) => f.id === editOpen)}
          canDelete={canDelete}
        />
      )}
      <Flex justify="end" px="4" py="3">
        {canAddAndEdit ? (
          <Button size="sm" variant="outline" onClick={() => setNewOpen(true)}>
            New filter
          </Button>
        ) : null}
      </Flex>
      {filters.length ? (
        <table className={`table gbtable mb-0 ${styles.detailsTable}`}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Filter SQL</th>
            </tr>
          </thead>
          <tbody>
            {filters.map((filter) => (
              <tr key={filter.id}>
                <td>
                  {canAddAndEdit && !filter.managedBy ? (
                    <Link weight="bold" onClick={() => setEditOpen(filter.id)}>
                      {filter.name}
                    </Link>
                  ) : (
                    filter.name
                  )}
                  <OfficialBadge type="filter" managedBy={filter.managedBy} />
                </td>
                <td>
                  <InlineCode language="sql" code={filter.value} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Box px="4" pb="3">
          <Text color="text-mid">No Saved Filters on this Fact Table yet.</Text>
        </Box>
      )}
    </div>
  );
}

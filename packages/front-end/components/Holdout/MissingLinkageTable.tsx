import { useState } from "react";
import { HoldoutMissingLinkage } from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import { PiWarningFill } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";

export default function MissingLinkageTable({
  holdoutId,
  missing,
  canEdit,
  mutate,
}: {
  holdoutId: string;
  missing: HoldoutMissingLinkage;
  canEdit: boolean;
  mutate: () => void;
}) {
  const { apiCall } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const rows = [
    ...missing.experiments.map((link) => ({
      ...link,
      kind: "experiment" as const,
    })),
    ...missing.features.map((link) => ({ ...link, kind: "feature" as const })),
  ];
  if (!rows.length) return null;

  return (
    <Box mt="5">
      <Flex align="center" gap="2" mb="1">
        <Flex style={{ color: "var(--amber-11)" }}>
          <PiWarningFill />
        </Flex>
        <Heading as="h5" size="xs" mb="0">
          Missing Linkage ({rows.length})
        </Heading>
      </Flex>
      <Text as="p" color="text-mid" mb="3">
        This holdout still lists these, but they no longer belong to it.
        Removing one only drops it from this list.
      </Text>
      {error ? (
        <Callout status="error" size="sm" mb="3">
          {error}
        </Callout>
      ) : null}
      <Table variant="list" roundedCorners>
        <TableHeader>
          <TableRow>
            <TableColumnHeader>Name</TableColumnHeader>
            <TableColumnHeader>Type</TableColumnHeader>
            <TableColumnHeader>Problem</TableColumnHeader>
            {canEdit ? <TableColumnHeader style={{ width: 100 }} /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.kind}-${row.id}`}>
              <TableCell>
                {row.problem === "deleted" ? (
                  <Text color="text-mid">{row.id}</Text>
                ) : (
                  <Link
                    href={
                      row.kind === "experiment"
                        ? `/experiment/${row.id}`
                        : `/features/${row.id}`
                    }
                    style={{ color: "var(--color-text-high)" }}
                  >
                    {row.name ?? row.id}
                  </Link>
                )}
              </TableCell>
              <TableCell>
                {row.kind === "experiment" ? "Experiment" : "Feature Flag"}
              </TableCell>
              <TableCell>
                <Text color="text-mid">
                  {row.problem === "deleted"
                    ? "Deleted"
                    : "No longer in this holdout"}
                </Text>
              </TableCell>
              {canEdit ? (
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    color="red"
                    setError={setError}
                    onClick={async () => {
                      await apiCall(
                        `/holdout/${holdoutId}/missing/${row.kind}/${row.id}`,
                        { method: "DELETE" },
                      );
                      mutate();
                    }}
                  >
                    Remove
                  </Button>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

import { Namespaces, NamespaceUsage } from "shared/types/organization";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { MouseEventHandler, useMemo, useState } from "react";
import { BsThreeDotsVertical } from "react-icons/bs";
import { findGaps } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import NamespaceUsageGraph from "@/components/Features/NamespaceUsageGraph";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import Badge from "@/ui/Badge";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

export interface Props {
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
  const experiments = useMemo(
    () => usage[namespace.name] ?? [],
    [usage, namespace.name],
  );
  const uniqueExperimentCount = useMemo(() => {
    const seen = new Set<string>();
    for (const e of experiments) {
      seen.add(`${e.link}|${e.trackingKey || e.id}`);
    }
    return seen.size;
  }, [experiments]);

  const availablePercent = useMemo(
    () =>
      findGaps(usage, namespace.name).reduce(
        (sum, r) => sum + (r.end - r.start),
        0,
      ),
    [usage, namespace.name],
  );
  const sortedExperiments = useMemo(
    () =>
      [...experiments].sort((a, b) => {
        const ka = `${a.link}|${a.trackingKey || a.id}`;
        const kb = `${b.link}|${b.trackingKey || b.id}`;
        return ka.localeCompare(kb);
      }),
    [experiments],
  );
  const overlappingIndices = useMemo(
    () =>
      new Set(
        sortedExperiments.flatMap((e, i) =>
          sortedExperiments.some(
            (f, j) =>
              j !== i &&
              (f.trackingKey || f.id) !== (e.trackingKey || e.id) &&
              e.start < f.end &&
              f.start < e.end,
          )
            ? [i]
            : [],
        ),
      ),
    [sortedExperiments],
  );

  const permissionsUtil = usePermissionsUtil();
  const canEdit = permissionsUtil.canUpdateNamespace();
  const canDelete = permissionsUtil.canDeleteNamespace();

  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hoverRange, setHoverRange] = useState<[number, number] | null>(null);

  const isInactive = (namespace?.status ?? "active") === "inactive";

  const toggleExpand: MouseEventHandler = (e) => {
    e.preventDefault();
    setExpanded((v) => !v);
  };

  return (
    <>
      <TableRow style={{ cursor: "pointer", opacity: isInactive ? 0.6 : 1 }}>
        <TableCell onClick={toggleExpand}>
          <Text color={isInactive ? "text-mid" : undefined}>
            {namespace.label}
          </Text>
          {isInactive && (
            <Badge
              label="Disabled"
              color="gray"
              variant="soft"
              size="sm"
              ml="2"
              title="This namespace is hidden and cannot be used for new experiments"
            />
          )}
        </TableCell>
        <TableCell onClick={toggleExpand}>
          <Text color={isInactive ? "text-mid" : undefined}>
            {namespace.description}
          </Text>
        </TableCell>
        <TableCell onClick={toggleExpand} justify="end">
          <Box pr="2">
            <Text color={isInactive ? "text-mid" : undefined}>
              {uniqueExperimentCount}
            </Text>
          </Box>
        </TableCell>
        <TableCell onClick={toggleExpand} justify="end">
          <Box pr="2">
            <Text color={isInactive ? "text-mid" : undefined}>
              {percentFormatter.format(availablePercent)}
            </Text>
          </Box>
        </TableCell>
        <TableCell>
          <DropdownMenu
            trigger={
              <IconButton
                variant="ghost"
                color="gray"
                radius="full"
                size="2"
                highContrast
              >
                <BsThreeDotsVertical size={18} />
              </IconButton>
            }
            open={menuOpen}
            onOpenChange={setMenuOpen}
            menuPlacement="end"
            variant="soft"
          >
            <DropdownMenuGroup>
              {canEdit && (
                <>
                  <DropdownMenuItem
                    onClick={() => {
                      onEdit();
                      setMenuOpen(false);
                    }}
                  >
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={
                      isInactive || uniqueExperimentCount === 0
                        ? async () => {
                            await onArchive();
                            setMenuOpen(false);
                          }
                        : undefined
                    }
                    confirmation={
                      !isInactive && uniqueExperimentCount > 0
                        ? {
                            submit: async () => {
                              await onArchive();
                              setMenuOpen(false);
                            },
                            confirmationTitle: "Disable Namespace",
                            cta: "Disable",
                            submitColor: "danger",
                            getConfirmationContent: async () =>
                              `This namespace has ${uniqueExperimentCount} experiment${uniqueExperimentCount !== 1 ? "s" : ""} using it. Disabling hides it from the namespace picker but does not affect existing experiments or the SDK payload.`,
                          }
                        : undefined
                    }
                  >
                    {isInactive ? "Enable" : "Disable"}
                  </DropdownMenuItem>
                </>
              )}
              {experiments.length === 0 && canDelete && (
                <DropdownMenuItem
                  color="red"
                  confirmation={{
                    submit: onDelete,
                    confirmationTitle: "Delete Namespace",
                    cta: "Delete",
                    getConfirmationContent: async () =>
                      "Are you sure? This action cannot be undone.",
                  }}
                >
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </DropdownMenu>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow data-no-hover>
          <TableCell
            colSpan={5}
            px="6"
            py="5"
            style={{
              boxShadow: "rgba(0,0,0,0.06) 0px 2px 4px 0px inset",
              borderBottom: "1px solid var(--slate-a5, rgba(0,9,50,0.12))",
              backgroundColor: "var(--color-background)",
            }}
          >
            <NamespaceUsageGraph
              namespace={namespace.name}
              usage={usage}
              title="Namespace Usage"
              range={hoverRange ?? undefined}
            />
            {experiments.length > 0 ? (
              <Table variant="ghost" mt="4">
                <TableHeader>
                  <TableRow>
                    <TableColumnHeader>Experiment</TableColumnHeader>
                    <TableColumnHeader>Tracking Key</TableColumnHeader>
                    <TableColumnHeader style={{ width: 300 }}>
                      Range
                    </TableColumnHeader>
                  </TableRow>
                </TableHeader>
                <TableBody onMouseLeave={() => setHoverRange(null)}>
                  {sortedExperiments.map((e, i) => {
                    const key = `${e.link}|${e.trackingKey || e.id}`;
                    const prevKey =
                      i > 0
                        ? `${sortedExperiments[i - 1].link}|${sortedExperiments[i - 1].trackingKey || sortedExperiments[i - 1].id}`
                        : null;
                    const nextKey =
                      i < sortedExperiments.length - 1
                        ? `${sortedExperiments[i + 1].link}|${sortedExperiments[i + 1].trackingKey || sortedExperiments[i + 1].id}`
                        : null;
                    const isFirstInGroup = key !== prevKey;
                    const isLastInGroup = key !== nextKey;

                    return (
                      <TableRow
                        key={i}
                        onMouseEnter={() => setHoverRange([e.start, e.end])}
                        data-group-inner={!isLastInGroup ? "" : undefined}
                      >
                        <TableCell>
                          {isFirstInGroup ? (
                            <Link href={e.link} target="_blank">
                              {e.name}
                            </Link>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {isFirstInGroup ? e.trackingKey || e.id : null}
                        </TableCell>
                        <TableCell>
                          <Flex align="center" justify="between" gap="2">
                            <Text>
                              {e.start} to {e.end}
                            </Text>
                            {overlappingIndices.has(i) && (
                              <HelperText status="warning" size="sm">
                                Ranges overlap
                              </HelperText>
                            )}
                          </Flex>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <Text as="p" color="text-mid" fontStyle="italic">
                No active experiments are using this namespace
              </Text>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

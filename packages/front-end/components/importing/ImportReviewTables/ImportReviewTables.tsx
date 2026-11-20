import React, { Fragment, useState } from "react";
import { Box, Flex, Grid, VisuallyHidden } from "@radix-ui/themes";
import Frame from "@/ui/Frame";
import Badge from "@/ui/Badge";
import Checkbox from "@/ui/Checkbox";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
  TableRowHeaderCell,
} from "@/ui/Table";
import Code from "@/components/SyntaxHighlighting/Code";

export type ReviewItem = {
  key: string;
  name: string;
  // The other service's object, shown beside the GrowthBook preview
  source: unknown;
  existingId?: string;
  match?: "run" | "name";
  status: "pending" | "invalid" | "completed" | "failed";
  error?: string;
  preview?: unknown;
};

function StatusBadge({
  item,
  untouchable,
}: {
  item: ReviewItem;
  untouchable: boolean;
}) {
  switch (item.status) {
    case "invalid":
      return <Badge color="red" label="Can't import" />;
    case "failed":
      return <Badge color="red" label="Failed" />;
    case "completed":
      return <Badge color="green" label="Imported" />;
    case "pending":
      if (item.match === "name") return <Badge color="amber" label="Exists" />;
      if (item.existingId && untouchable) {
        return <Badge color="gray" label="No change" />;
      }
      return (
        <Badge color="gray" label={item.existingId ? "Update" : "Create"} />
      );
  }
}

// One selectable table per category of things an importer found
export default function ImportReviewTables<C extends string>({
  categories,
  sourceName,
  hrefs,
  untouchedCategories,
  getItems,
  isSelected,
  setSelected,
}: {
  categories: { key: C; label: string }[];
  sourceName: string;
  hrefs: Partial<Record<C, (id: string) => string>>;
  // Categories whose existing items are left as they are
  untouchedCategories: C[];
  getItems: (category: C) => ReviewItem[];
  isSelected: (category: C, key: string) => boolean;
  setSelected: (category: C, keys: string[], selected: boolean) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <>
      {categories.map(({ key: category, label }) => {
        const items = getItems(category);
        if (!items.length) return null;
        const untouchable = untouchedCategories.includes(category);
        const untouched = (item: ReviewItem) =>
          untouchable && !!item.existingId;
        const selectable = items.filter(
          (item) => item.status !== "invalid" && !untouched(item),
        );
        const keys = selectable.map((i) => i.key);
        const selected = selectable.filter((i) =>
          isSelected(category, i.key),
        ).length;
        const href = hrefs[category];
        const unchanged = items.filter(untouched).length;
        return (
          <Frame key={category}>
            <Checkbox
              label={`${label} (${keys.length})${
                unchanged > 0 ? ` · ${unchanged} unchanged` : ""
              }`}
              value={
                selected === keys.length && selected > 0
                  ? true
                  : selected
                    ? "indeterminate"
                    : false
              }
              setValue={(v) => setSelected(category, keys, v)}
              disabled={!keys.length}
              mb="3"
            />
            <Box style={{ maxHeight: 600, overflowY: "auto" }}>
              {/* The header sticks to this box, not the page */}
              <Table variant="list" stickyTopOffset={0}>
                <TableHeader>
                  <TableRow>
                    <TableColumnHeader style={{ width: 40 }}>
                      <VisuallyHidden>Select</VisuallyHidden>
                    </TableColumnHeader>
                    <TableColumnHeader>Name</TableColumnHeader>
                    <TableColumnHeader style={{ width: 140 }}>
                      Status
                    </TableColumnHeader>
                    <TableColumnHeader style={{ width: 100 }}>
                      <VisuallyHidden>Preview</VisuallyHidden>
                    </TableColumnHeader>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const id = `${category}:${item.key}`;
                    return (
                      <Fragment key={id}>
                        <TableRow align="center">
                          <TableCell>
                            {untouched(item) ? null : (
                              // A block wrapper, so the checkbox centers on the row instead of
                              // sitting on the text baseline
                              <Flex align="center">
                                <Checkbox
                                  size="sm"
                                  label={
                                    <VisuallyHidden>{item.name}</VisuallyHidden>
                                  }
                                  value={
                                    item.status !== "invalid" &&
                                    isSelected(category, item.key)
                                  }
                                  setValue={(v) =>
                                    setSelected(category, [item.key], v)
                                  }
                                  disabled={item.status === "invalid"}
                                />
                              </Flex>
                            )}
                          </TableCell>
                          <TableRowHeaderCell>
                            {item.name}
                            {item.existingId && href ? (
                              <HelperText status="info" size="sm">
                                {item.match === "name"
                                  ? "Same name as "
                                  : "Imported before as "}
                                <Link href={href(item.existingId)} external>
                                  {item.name}
                                </Link>
                              </HelperText>
                            ) : item.existingId ? (
                              <HelperText status="info" size="sm">
                                Already in GrowthBook
                              </HelperText>
                            ) : null}
                            {item.error ? (
                              <HelperText status="error" size="sm">
                                {item.error}
                              </HelperText>
                            ) : null}
                          </TableRowHeaderCell>
                          <TableCell>
                            <StatusBadge
                              item={item}
                              untouchable={untouchable}
                            />
                          </TableCell>
                          <TableCell>
                            <Link
                              aria-expanded={expanded === id}
                              onClick={() =>
                                setExpanded(expanded === id ? null : id)
                              }
                            >
                              {expanded === id ? "Hide JSON" : "View JSON"}
                            </Link>
                          </TableCell>
                        </TableRow>
                        {expanded === id ? (
                          <TableRow>
                            <TableCell colSpan={4}>
                              <Grid columns={{ initial: "1", md: "2" }} gap="3">
                                <Code
                                  language="json"
                                  filename={sourceName}
                                  code={JSON.stringify(item.source, null, 2)}
                                  maxHeight="400px"
                                />
                                <Code
                                  language="json"
                                  filename="GrowthBook"
                                  code={JSON.stringify(
                                    item.preview ?? null,
                                    null,
                                    2,
                                  )}
                                  maxHeight="400px"
                                />
                              </Grid>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          </Frame>
        );
      })}
    </>
  );
}

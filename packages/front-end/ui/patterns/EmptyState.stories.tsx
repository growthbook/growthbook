import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import EmptyState from "@/components/EmptyState";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import SegmentedControl from "@/ui/SegmentedControl";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import { TextField } from "@/ui/TextField";
import { StoryMeta } from "@/ui/storyMeta";

export const meta: StoryMeta = {
  name: "Empty State",
  category: "patterns",
  status: "stable",
  summary:
    "When nothing exists yet, explain what the resource is for and offer the next step: a docs link and a create button. When a filter hides every row, keep the table and say so in one row.",
  useWhen: [
    "A list page has no items yet.",
    "A search or filter matches nothing.",
  ],
  avoidWhen: [
    {
      reason: "The data failed to load.",
      use: "Loading and Errors",
    },
    {
      reason: "The feature needs a paid plan.",
      use: "Permission-Gated Action",
    },
  ],
  related: ["Table", "LinkButton", "Loading and Errors"],
  examples: ["pages/constants/index.tsx", "components/EmptyState.tsx"],
};

const ITEMS = ["checkout-timeout", "max-upload-size", "welcome-copy"];

export default function EmptyStateStory() {
  const [mode, setMode] = useState<"first-run" | "list">("first-run");
  const [search, setSearch] = useState("zzz");
  const canCreate = true;
  const addButton = <Button disabled={!canCreate}>Add Constant</Button>;
  const rows = ITEMS.filter((i) => i.includes(search.trim()));

  return (
    <Flex direction="column" gap="4">
      <SegmentedControl
        value={mode}
        setValue={setMode}
        aria-label="Example state"
        options={[
          { value: "first-run", label: "First run" },
          { value: "list", label: "No results" },
        ]}
      />
      {mode === "first-run" ? (
        <EmptyState
          title="Reusable values for your Configs"
          description="Define a value once and reference it everywhere. Change it in one place and every consumer updates."
          leftButton={
            <LinkButton
              href="https://docs.growthbook.io/features/constants"
              variant="outline"
              external={true}
            >
              View docs
            </LinkButton>
          }
          rightButton={canCreate ? addButton : null}
        />
      ) : (
        <Box>
          <TextField
            label="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            mb="3"
          />
          <Table variant="surface">
            <TableHeader>
              <TableRow>
                <TableColumnHeader>Key</TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r}>
                  <TableCell>{r}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell style={{ textAlign: "center" }}>
                    {search.trim()
                      ? "No Constants match the current filter."
                      : "No Constants found."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      )}
    </Flex>
  );
}

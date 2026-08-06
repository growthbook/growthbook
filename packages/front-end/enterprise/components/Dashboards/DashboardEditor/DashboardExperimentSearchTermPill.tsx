import { useEffect, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretDown } from "react-icons/pi";
import Field from "@/components/Forms/Field";
import { Popover } from "@/ui/Popover";
import Button from "@/ui/Button";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import styles from "./DashboardControlPill.module.scss";

interface Props {
  value: string;
  disabled?: boolean;
  onChange: (searchTerm: string) => void;
}

/**
 * The free-text portion of the dashboard's experiment search string.
 *
 * The filter bar authors filters as `field:value` pills, so a free-text term can
 * only arrive from the API or a hand-typed string. This pill renders only when
 * such a term exists, so a saved search term is never silently applied with no
 * way to see or clear it.
 */
export default function DashboardExperimentSearchTermPill({
  value,
  disabled,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft.trim() === value.trim()) return;
    onChange(draft.trim());
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) commit();
        setOpen(nextOpen);
      }}
      trigger={
        <Button
          variant="outline"
          color="gray"
          size="md"
          className={styles.controlPill}
          disabled={disabled}
          style={{ justifyContent: "space-between" }}
        >
          <Flex align="center" gap="2">
            <span
              style={{
                maxWidth: 160,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={value}
            >
              {`Search: ${value}`}
            </span>
            <PiCaretDown aria-hidden />
          </Flex>
        </Button>
      }
      align="start"
      showArrow={false}
      contentStyle={{ padding: "12px", width: 280 }}
      content={
        <Flex direction="column" gap="2">
          <Text size="sm" color="text-low">
            Matches experiment names
          </Text>
          <Field
            autoFocus
            containerClassName="mb-0"
            placeholder="Search experiments..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
                setOpen(false);
              }
            }}
          />
          <Box>
            <Link
              size="sm"
              color="red"
              onClick={() => {
                setDraft("");
                onChange("");
                setOpen(false);
              }}
            >
              Clear
            </Link>
          </Box>
        </Flex>
      }
    />
  );
}

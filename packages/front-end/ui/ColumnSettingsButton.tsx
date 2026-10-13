import { ReactNode, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiTextColumns } from "react-icons/pi";
import { Popover } from "@/ui/Popover";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import ColumnSettings, { ManagedColumn } from "@/ui/ColumnSettings";
import columnStyles from "@/ui/ColumnSettings.module.scss";

export default function ColumnSettingsButton({
  columns,
  hiddenCount = 0,
  onChange,
  onReset,
  canReset,
  note,
  trigger,
  title,
  visibleFirst = false,
  plainRows = false,
  contentClassName,
  contentPadding,
  width = 260,
}: {
  columns: ManagedColumn[];
  /** Named on the default trigger, which has no room to show it. */
  hiddenCount?: number;
  onChange: (columns: { id: string; visible: boolean }[]) => void;
  onReset?: () => void;
  canReset?: boolean;
  /** Appended to the popover's helper copy, e.g. which column is pinned. */
  note?: string;
  /** Overrides the default trigger, for hosts that need another weight. */
  trigger?: ReactNode;
  /** A heading in place of the helper copy (and its note), e.g. "Columns". */
  title?: string;
  /** Lists the shown columns first, in the table's order, then the hidden
   * ones. Sorted when the popover opens, not on every toggle, so rows don't
   * jump while it's open. */
  visibleFirst?: boolean;
  /** Passed to ColumnSettings. */
  plainRows?: boolean;
  /** Extra class on the popover, e.g. for its shadow. */
  contentClassName?: string;
  /** The popover's padding, in place of Popover's 15px 20px. */
  contentPadding?: string;
  /** The width of the popover's contents, inside its padding. */
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  // visibleFirst: the row order, fixed while the popover is open.
  const [order, setOrder] = useState<string[] | null>(null);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (visibleFirst && next) {
      setOrder([
        ...columns.filter((c) => c.visible).map((c) => c.id),
        ...columns.filter((c) => !c.visible).map((c) => c.id),
      ]);
    }
  };

  const listed =
    visibleFirst && order
      ? [
          ...order
            .map((id) => columns.find((c) => c.id === id))
            .filter((c): c is ManagedColumn => !!c),
          ...columns.filter((c) => !order.includes(c.id)),
        ]
      : columns;

  const label = hiddenCount > 0 ? `Columns, ${hiddenCount} hidden` : "Columns";

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      align="end"
      contentClassName={contentClassName}
      contentStyle={contentPadding ? { padding: contentPadding } : undefined}
      trigger={
        trigger ?? (
          <IconButton
            variant="ghost"
            color="gray"
            radius="small"
            // Matches the row-action kebab below it, so the two line up.
            size="2"
            highContrast
            aria-label={label}
            title={label}
          >
            <PiTextColumns size={18} />
          </IconButton>
        )
      }
      content={
        <Box style={{ width }}>
          {title ? (
            // The reset link on the heading's line, right-aligned, as just
            // "Reset" (set in review), rather than below the list.
            <Flex mb="2" px="2" align="center" justify="between" gap="3">
              <Text size="md" weight="medium">
                {title}
              </Text>
              {onReset && canReset ? (
                // --gray-12, as the redesign's other links (View Rules, the
                // rail's Holdout; set in review), underlined on hover.
                <Link onClick={onReset} className={columnStyles.neutralLink}>
                  <Text size="sm">Reset</Text>
                </Link>
              ) : null}
            </Flex>
          ) : (
            <Box mb="2">
              <Text size="sm" color="text-low">
                Drag to reorder; check to show or hide. Saved in this browser
                only, not shared with your team.{note ? ` ${note}` : ""}
              </Text>
            </Box>
          )}
          <ColumnSettings
            columns={listed}
            onChange={(next) => {
              if (!visibleFirst) {
                onChange(next);
                return;
              }
              // visibleFirst lists columns in its own order, so a checkbox
              // only changes visibility, in the table's own order (set in
              // review): emitting the list's order would also reorder the
              // table, and leave it "customized" (Reset showing) after a
              // column is turned off and on again. A drag reorders, in the
              // list's order.
              const reordered = next.some((c, i) => c.id !== listed[i]?.id);
              if (reordered) {
                setOrder(next.map((c) => c.id));
                onChange(next);
                return;
              }
              const visibleById = new Map(next.map((c) => [c.id, c.visible]));
              onChange(
                columns.map((c) => ({
                  id: c.id,
                  visible: visibleById.get(c.id) ?? c.visible,
                })),
              );
            }}
            plainRows={plainRows}
            // With a heading, the reset link is on its line instead.
            {...(title ? {} : { onReset, canReset })}
          />
        </Box>
      }
    />
  );
}

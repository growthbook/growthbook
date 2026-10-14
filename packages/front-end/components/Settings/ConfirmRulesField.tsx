import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { createFilter } from "react-select";
import {
  PiCaretDown,
  PiCaretRight,
  PiCheckBold,
  PiPlusBold,
  PiTrash,
} from "react-icons/pi";
import { ConfirmRule } from "shared/validators";
import useApi from "@/hooks/useApi";
import EnvironmentScopeCell from "@/components/Settings/EnvironmentScopeCell";
import { SingleValue } from "@/components/Forms/SelectField";
import Link from "@/ui/Link";
import MultiSelectField from "@/ui/MultiSelectField";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import styles from "./ConfirmRulesField.module.scss";
import {
  ALL,
  actionsOf,
  Category,
  CATEGORIES,
  CATEGORY_TITLES,
  categoryOf,
  covers,
  isCategory,
  toggleAction,
  isCatchAll,
  verbOf,
} from "./confirmRulesUtils";

const search = createFilter<SingleValue>();

const WIDTHS = ["4%", "47%", "43%", "6%"];

const PLUS = (
  <Text color="text-low">
    <PiPlusBold size={11} />
  </Text>
);

// One row per category, selectable as a whole (`feature.*`); a caret reveals
// its actions.
function ActionsField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const { data } = useApi<{ coverage: Record<string, string[]> }>(
    "/confirmations/actions",
  );
  const coverage = data?.coverage;
  // Changes only when coverage loads, so react-select keeps its highlighted
  // row across picks; collapsed categories hide their actions in the filter.
  const options = useMemo(
    () => [
      { label: "All actions", value: ALL },
      ...CATEGORIES.flatMap((category) => [
        { label: CATEGORY_TITLES[category], value: `${category}.*` },
        ...actionsOf(category).map((label) => ({
          label: `${CATEGORY_TITLES[category]}: ${verbOf(label)}`,
          value: label,
          // The catch-all's members aren't obvious from its name.
          tooltip:
            isCatchAll(label) && coverage?.[label]?.length ? (
              <Flex direction="column">
                {coverage[label].map((call) => (
                  <span key={call}>{call}</span>
                ))}
              </Flex>
            ) : undefined,
        })),
      ]),
    ],
    [coverage],
  );

  const [expanded, setExpanded] = useState<Set<Category>>(
    () =>
      new Set(value.filter((v) => v !== ALL && !isCategory(v)).map(categoryOf)),
  );
  const toggle = (category: Category) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  return (
    <MultiSelectField
      aria-label="Actions"
      value={value}
      options={options}
      sort={false}
      hideSelectedOptions={false}
      // Searching reaches every action; otherwise only expanded ones show.
      filterOption={(option, input) =>
        input
          ? search(option, input)
          : option.value === ALL ||
            isCategory(option.value) ||
            expanded.has(categoryOf(option.value))
      }
      // Arrow keys open and close the highlighted category, like a tree.
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        if ((e.target as HTMLInputElement).value) return;
        const value = document
          .querySelector(".gb-multi-select__option--is-focused [data-action]")
          ?.getAttribute("data-action");
        if (!value || value === ALL) return;
        const category = categoryOf(value);
        const open = expanded.has(category);
        if (e.key === "ArrowRight" ? !open && isCategory(value) : open) {
          e.preventDefault();
          toggle(category);
        }
      }}
      onChange={(next) => {
        if (!next.length) return onChange([]);
        const clicked =
          next.find((v) => !value.includes(v)) ??
          value.find((v) => !next.includes(v));
        if (clicked) onChange(toggleAction(value, clicked));
      }}
      containerClassName="mb-0"
      formatOptionLabel={(option, meta) => {
        if (meta.context !== "menu") return option.label;
        const category = isCategory(option.value)
          ? categoryOf(option.value)
          : null;
        const isChecked = covers(value, option.value);
        return (
          <Flex align="center" gap="1" data-action={option.value}>
            <Flex
              flexShrink="0"
              className={clsx(styles.check, isChecked && styles.checked)}
            >
              <PiCheckBold />
            </Flex>
            {category ? (
              <IconButton
                type="button"
                variant="ghost"
                color="gray"
                size="1"
                className={styles.caret}
                aria-label={`${expanded.has(category) ? "Hide" : "Show"} ${option.label} actions`}
                tabIndex={-1}
                aria-expanded={expanded.has(category)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(category);
                }}
              >
                {expanded.has(category) ? <PiCaretDown /> : <PiCaretRight />}
              </IconButton>
            ) : (
              option.value !== ALL && <Box width="24px" flexShrink="0" />
            )}
            <Box pl={option.value === ALL || category ? "0" : "4"}>
              {option.value === ALL || category
                ? option.label
                : verbOf(option.value)}
            </Box>
          </Flex>
        );
      }}
    />
  );
}

export const SUGGESTED_CONFIRM_RULES: ConfirmRule[] = [{ actions: [ALL] }];

export default function ConfirmRulesField({
  value,
  setValue,
}: {
  value: ConfirmRule[];
  setValue: (rules: ConfirmRule[]) => void;
}) {
  const update = (i: number, rule: ConfirmRule) =>
    setValue(value.map((r, j) => (j === i ? rule : r)));
  // Row keys that follow their rule, so a removed row's open pickers go with it.
  const keys = useRef<number[]>([]);
  const nextKey = useRef(0);
  keys.current = keys.current.slice(0, value.length);
  while (keys.current.length < value.length) {
    keys.current.push(nextKey.current++);
  }

  // Laid out like the permissions table: any rule that matches holds.
  return (
    <Table variant="surface" layout="fixed">
      <TableHeader>
        <TableRow>
          <TableColumnHeader width={WIDTHS[0]} />
          <TableColumnHeader width={WIDTHS[1]}>Actions</TableColumnHeader>
          <TableColumnHeader width={WIDTHS[2]}>Environments</TableColumnHeader>
          <TableColumnHeader width={WIDTHS[3]} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {value.map((rule, i) => (
          <TableRow key={keys.current[i]} style={{ verticalAlign: "middle" }}>
            <TableCell width={WIDTHS[0]}>{i > 0 && PLUS}</TableCell>
            <TableCell width={WIDTHS[1]}>
              <ActionsField
                value={rule.actions}
                onChange={(actions) => update(i, { ...rule, actions })}
              />
            </TableCell>
            <TableCell width={WIDTHS[2]}>
              <EnvironmentScopeCell
                environments={rule.environments ?? null}
                onChange={(next) =>
                  update(i, {
                    ...rule,
                    environments: next?.length ? next : undefined,
                  })
                }
              />
            </TableCell>
            <TableCell width={WIDTHS[3]}>
              <Flex align="center" justify="end">
                <Tooltip content="Remove rule">
                  <IconButton
                    variant="ghost"
                    color="red"
                    radius="full"
                    size="3"
                    style={{ margin: 0 }}
                    aria-label="Remove rule"
                    onClick={() => {
                      keys.current.splice(i, 1);
                      setValue(value.filter((_, j) => j !== i));
                    }}
                  >
                    <PiTrash size={16} />
                  </IconButton>
                </Tooltip>
              </Flex>
            </TableCell>
          </TableRow>
        ))}
        <TableRow style={{ verticalAlign: "middle" }}>
          <TableCell width={WIDTHS[0]}>{PLUS}</TableCell>
          <TableCell colSpan={3}>
            <Link
              weight="medium"
              onClick={() => setValue([...value, { actions: [] }])}
            >
              Add rule
            </Link>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

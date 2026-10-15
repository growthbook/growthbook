import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { createFilter } from "react-select";
import {
  PiCaretDown,
  PiCaretRight,
  PiCheckBold,
  PiMinusBold,
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
  isCatchAll,
  isCategory,
  isPartlyPicked,
  isPicked,
  isSingleAction,
  RECOMMENDED,
  SECTIONS,
  toggleAction,
  verbOf,
} from "./confirmRulesUtils";

const search = createFilter<SingleValue>();

const WIDTHS = ["4%", "47%", "43%", "6%"];

const PLUS = (
  <Text color="text-low">
    <PiPlusBold size={11} />
  </Text>
);

const isPreset = (value: string) => value === ALL || value === RECOMMENDED;

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
  const options = useMemo(() => {
    // A catch-all's members aren't obvious from its name.
    const calls = (action: string) =>
      isCatchAll(action) && coverage?.[action]?.length ? (
        <Flex direction="column">
          {coverage[action].map((call) => (
            <span key={call}>{call}</span>
          ))}
        </Flex>
      ) : undefined;
    return [
      {
        label: "",
        options: [
          { label: "Recommended actions", value: RECOMMENDED },
          { label: "All actions", value: ALL },
        ],
      },
      ...SECTIONS.map(({ title, categories }) => ({
        label: title,
        options: categories.flatMap((category) =>
          isSingleAction(category)
            ? [
                {
                  label: CATEGORY_TITLES[category],
                  value: `${category}.*`,
                  tooltip: calls(actionsOf(category)[0]),
                },
              ]
            : [
                { label: CATEGORY_TITLES[category], value: `${category}.*` },
                ...actionsOf(category).map((action) => ({
                  label: `${CATEGORY_TITLES[category]}: ${verbOf(action)}`,
                  value: action,
                  tooltip: calls(action),
                })),
              ],
        ),
      })),
    ];
  }, [coverage]);

  // A partly picked category opens on its own; one the person opened, closed
  // or picked inside stays as they left it.
  const [opened, setOpened] = useState<Partial<Record<Category, boolean>>>({});
  const partlyPicked = useMemo(
    () => new Set(CATEGORIES.filter((c) => isPartlyPicked(value, `${c}.*`))),
    [value],
  );
  const isOpen = (category: Category) =>
    opened[category] ?? partlyPicked.has(category);
  const setOpen = (category: Category, open: boolean) =>
    setOpened((prev) => ({ ...prev, [category]: open }));

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
          : isPreset(option.value) ||
            isCategory(option.value) ||
            isOpen(categoryOf(option.value))
      }
      // Arrow keys open and close the highlighted category, like a tree.
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        if ((e.target as HTMLInputElement).value) return;
        const value = document
          .querySelector(".gb-multi-select__option--is-focused [data-action]")
          ?.getAttribute("data-action");
        if (!value) return;
        // While a row is highlighted the arrows only open and close categories.
        e.preventDefault();
        if (!isCategory(value) || isSingleAction(categoryOf(value))) return;
        const category = categoryOf(value);
        const open = isOpen(category);
        if (e.key === "ArrowRight" ? !open : open) setOpen(category, !open);
      }}
      onChange={(next, action) => {
        // Removing a chip drops just that pick; a menu row toggles all it covers.
        if (
          !next.length ||
          action === "remove-value" ||
          action === "pop-value"
        ) {
          return onChange(next);
        }
        const clicked =
          next.find((v) => !value.includes(v)) ??
          value.find((v) => !next.includes(v));
        if (!clicked) return;
        if (!isPreset(clicked) && !isCategory(clicked)) {
          setOpen(categoryOf(clicked), true);
        }
        onChange(toggleAction(value, clicked));
      }}
      formatOptionLabel={(option, meta) => {
        if (meta.context !== "menu") return option.label;
        const category =
          isCategory(option.value) && !isSingleAction(categoryOf(option.value))
            ? categoryOf(option.value)
            : null;
        const header = isPreset(option.value) || isCategory(option.value);
        const isChecked = isPicked(value, option.value);
        const isPartly =
          !isChecked &&
          option.value !== ALL &&
          header &&
          isPartlyPicked(value, option.value);
        const open = category ? isOpen(category) : false;
        return (
          <Flex align="center" gap="1" data-action={option.value}>
            <Flex
              flexShrink="0"
              className={clsx(
                styles.check,
                (isChecked || isPartly) && styles.checked,
                isPartly && styles.partly,
              )}
            >
              {isPartly && <PiMinusBold className={styles.dash} />}
              <PiCheckBold className={styles.tick} />
            </Flex>
            {category ? (
              <IconButton
                type="button"
                variant="ghost"
                color="gray"
                size="1"
                className={styles.caret}
                aria-label={`${open ? "Hide" : "Show"} ${option.label} actions`}
                tabIndex={-1}
                aria-expanded={open}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(category, !open);
                }}
              >
                {open ? <PiCaretDown /> : <PiCaretRight />}
              </IconButton>
            ) : (
              !isPreset(option.value) && <Box width="24px" flexShrink="0" />
            )}
            <Box pl={header ? "0" : "4"}>
              {header ? option.label : verbOf(option.value)}
            </Box>
          </Flex>
        );
      }}
    />
  );
}

export const SUGGESTED_CONFIRM_RULES: ConfirmRule[] = [
  { actions: [RECOMMENDED] },
];

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
                    type="button"
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

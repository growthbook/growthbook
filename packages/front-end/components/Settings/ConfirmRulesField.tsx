import { useMemo, useState } from "react";
import clsx from "clsx";
import { Box, Flex, Grid, IconButton } from "@radix-ui/themes";
import { createFilter } from "react-select";
import {
  PiCaretDown,
  PiCaretRight,
  PiCheckBold,
  PiTrash,
} from "react-icons/pi";
import { ConfirmRule } from "shared/validators";
import { useEnvironments } from "@/services/features";
import useApi from "@/hooks/useApi";
import { SingleValue } from "@/components/Forms/SelectField";
import Button from "@/ui/Button";
import MultiSelectField from "@/ui/MultiSelectField";
import styles from "./ConfirmRulesField.module.scss";
import {
  ALL,
  actionsOf,
  Category,
  CATEGORIES,
  CATEGORY_TITLES,
  categoryOf,
  isCategory,
  toggleAction,
  isCatchAll,
  verbOf,
} from "./confirmRulesUtils";

const search = createFilter<SingleValue>();

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
    "/confirmations/labels",
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

  const covered = (v: string) =>
    v !== ALL &&
    (value.includes(ALL) ||
      (!isCategory(v) && value.includes(`${categoryOf(v)}.*`)));

  return (
    <MultiSelectField
      label="Actions"
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
      onChange={(next) => {
        if (!next.length) return onChange([]);
        const clicked =
          next.find((v) => !value.includes(v)) ??
          value.find((v) => !next.includes(v));
        if (clicked) onChange(toggleAction(value, clicked));
      }}
      formatOptionLabel={(option, meta) => {
        if (meta.context !== "menu") return option.label;
        const category = isCategory(option.value)
          ? categoryOf(option.value)
          : null;
        const checked =
          meta.selectValue.some((s) => s.value === option.value) ||
          covered(option.value);
        return (
          <Flex align="center" gap="1">
            <Flex
              flexShrink="0"
              className={clsx(styles.check, checked && styles.checked)}
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
                aria-label={`Show ${option.label} actions`}
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

export const withoutEmptyRules = (rules: ConfirmRule[]) =>
  rules.filter((rule) => rule.actions.length);

export default function ConfirmRulesField({
  value,
  setValue,
}: {
  value: ConfirmRule[];
  setValue: (rules: ConfirmRule[]) => void;
}) {
  const environments = useEnvironments();
  const envOptions = environments.map((e) => ({ label: e.id, value: e.id }));
  const update = (i: number, rule: ConfirmRule) =>
    setValue(value.map((r, j) => (j === i ? rule : r)));

  return (
    <Box>
      {value.map((rule, i) => (
        // minmax(0, …) keeps long chip lists from pushing past half the row.
        <Grid
          key={i}
          columns="minmax(0, 1fr) minmax(0, 1fr) auto"
          gap="3"
          align="end"
          mb="3"
        >
          <ActionsField
            value={rule.actions}
            onChange={(actions) => update(i, { ...rule, actions })}
          />
          <MultiSelectField
            label="Environments"
            placeholder="All environments"
            value={rule.environments ?? []}
            options={envOptions}
            onChange={(envs) =>
              update(i, {
                ...rule,
                environments: envs.length ? envs : undefined,
              })
            }
          />
          <Button
            variant="ghost"
            color="red"
            aria-label="Remove rule"
            onClick={() => setValue(value.filter((_, j) => j !== i))}
          >
            <PiTrash />
          </Button>
        </Grid>
      ))}
      <Button
        variant="ghost"
        onClick={() => setValue([...value, { actions: [] }])}
      >
        Add rule
      </Button>
    </Box>
  );
}

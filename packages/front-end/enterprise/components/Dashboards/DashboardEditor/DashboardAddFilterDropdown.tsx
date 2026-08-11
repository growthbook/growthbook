import { useRef } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import {
  DASHBOARD_OPTIONAL_FILTERS,
  DashboardOptionalFilterKey,
} from "./dashboardFilterCatalog";
import styles from "./DashboardControlPill.module.scss";

// Why a filter can't be added yet. Each optional filter only drives blocks that
// support it, so with no such block on the dashboard the filter would do
// nothing.
const UNAVAILABLE_REASON: Record<
  (typeof DASHBOARD_OPTIONAL_FILTERS)[number]["requires"],
  string
> = {
  projects: "Add a block that includes experiments to use this filter",
  metricId:
    "Add an Experiments with Lift or Scaled Impact block to use this filter",
  experimentSearchString:
    "Add a block that includes experiments to use this filter",
};

// Sentence case, per the copy guide — these are status hints, not tokens.
const STATUS_LABEL = {
  added: "Added",
  unavailable: "Unavailable",
} as const;

interface Props {
  // Filters already in the bar — listed as "added" and not selectable.
  visibleKeys: DashboardOptionalFilterKey[];
  // Which requirements the current blocks satisfy.
  applicability: {
    projects: boolean;
    metricId: boolean;
    experimentSearchString: boolean;
  };
  disabled?: boolean;
  onAdd: (key: DashboardOptionalFilterKey) => void;
}

export default function DashboardAddFilterDropdown({
  visibleKeys,
  applicability,
  disabled,
  onAdd,
}: Props) {
  // Set when a filter was picked (rather than the menu being dismissed), so the
  // close handler below knows to leave focus for that filter's popover.
  const addedFilterRef = useRef(false);

  return (
    <DropdownMenu
      disabled={disabled}
      menuPlacement="start"
      menuWidth={360}
      onCloseAutoFocus={(e) => {
        // The new filter's pill opens its own popover and focuses its search
        // box. Radix would pull focus back to this trigger as the menu unmounts,
        // which that popover reads as focus leaving it — and dismisses itself.
        if (!addedFilterRef.current) return;
        addedFilterRef.current = false;
        e.preventDefault();
      }}
      trigger={
        <Button
          variant="outline"
          size="md"
          className={styles.controlPill}
          disabled={disabled}
          icon={<PiPlus aria-hidden />}
          iconPosition="left"
        >
          Add filter
        </Button>
      }
    >
      <DropdownMenuLabel
        textSize="sm"
        textStyle={{
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 600,
        }}
      >
        Add a filter
      </DropdownMenuLabel>
      {DASHBOARD_OPTIONAL_FILTERS.filter((filter) => filter.addable).map(
        (filter) => {
          const added = visibleKeys.includes(filter.key);
          const available = applicability[filter.requires];
          // Already in the bar, or no block on the dashboard honors it.
          const status = added ? "added" : available ? null : "unavailable";
          return (
            <DropdownMenuItem
              key={filter.key}
              disabled={status !== null}
              tooltip={
                status === "unavailable"
                  ? UNAVAILABLE_REASON[filter.requires]
                  : undefined
              }
              onClick={() => {
                addedFilterRef.current = true;
                onAdd(filter.key);
              }}
            >
              <Flex align="center" justify="between" gap="4" width="100%">
                <span>{filter.label}</span>
                {status ? (
                  <Text size="sm" color="text-low">
                    {STATUS_LABEL[status]}
                  </Text>
                ) : null}
              </Flex>
            </DropdownMenuItem>
          );
        },
      )}
      <DropdownMenuSeparator />
      <Box px="2" py="1">
        <Text size="sm" color="text-low">
          Only filters that apply to blocks on this dashboard are shown
        </Text>
      </Box>
    </DropdownMenu>
  );
}

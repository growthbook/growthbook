import { Flex } from "@radix-ui/themes";
import { RowFilter } from "shared/types/fact-table";
import { PiPlus, PiTable } from "react-icons/pi";
import { ReactNode } from "react";
import Button from "@/ui/Button";
import Tooltip from "@/components/Tooltip/Tooltip";
import { emptyColumnRowFilter, emptySqlRowFilter } from "./rowFilterUtils";

export function RowFilterActions({
  onAdd,
  disabled,
  children,
  onViewSampleRows,
  canViewSampleRows,
}: {
  onAdd: (filter: RowFilter) => void;
  disabled?: boolean;
  children?: ReactNode;
  onViewSampleRows?: () => void;
  canViewSampleRows?: boolean;
}) {
  return (
    <Flex align="center" justify="between" gap="2" wrap="wrap">
      <Flex align="center" gap="2" wrap="wrap">
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          icon={<PiPlus size={14} />}
          onClick={() => onAdd(emptyColumnRowFilter())}
        >
          Add filter
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          icon={<PiPlus size={14} />}
          onClick={() => onAdd(emptySqlRowFilter())}
        >
          Add SQL filter
        </Button>
      </Flex>
      <Flex align="center" gap="2" wrap="wrap">
        {onViewSampleRows && (
          <Tooltip
            shouldDisplay={!canViewSampleRows}
            body="Fill out all filters first"
          >
            <Button
              size="sm"
              variant="ghost"
              disabled={!canViewSampleRows}
              icon={<PiTable size={14} />}
              onClick={onViewSampleRows}
            >
              View sample rows
            </Button>
          </Tooltip>
        )}
        {children}
      </Flex>
    </Flex>
  );
}

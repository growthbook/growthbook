import { PiArrowClockwise, PiCaretDownFill } from "react-icons/pi";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import SplitButton from "@/ui/SplitButton";

export default function NewMetricsUpdateButton({
  onUpdateNewMetrics,
  onUpdateAllMetrics,
  disabled,
}: {
  onUpdateNewMetrics: () => Promise<void>;
  onUpdateAllMetrics: () => Promise<void>;
  disabled: boolean;
}) {
  return (
    <SplitButton
      variant="outline"
      menu={
        <DropdownMenu
          trigger={
            <Button
              variant="outline"
              size="md"
              aria-label="More update options"
              disabled={disabled}
            >
              <PiCaretDownFill />
            </Button>
          }
          menuPlacement="end"
          variant="soft"
        >
          {/* Not awaited: the update can open a dialog, and the menu would
              stay open behind it until the update finished. */}
          <DropdownMenuItem onClick={() => void onUpdateAllMetrics()}>
            Update all metrics
          </DropdownMenuItem>
        </DropdownMenu>
      }
    >
      <Button
        variant="outline"
        size="md"
        icon={<PiArrowClockwise />}
        disabled={disabled}
        onClick={onUpdateNewMetrics}
      >
        Update new metrics
      </Button>
    </SplitButton>
  );
}

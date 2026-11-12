import clsx from "clsx";
import { PiTextAaBold } from "react-icons/pi";
import FieldIndicator from "@/ui/FieldIndicator";

/** An operator select's indicator for matching text case-insensitively. */
export default function CaseInsensitiveToggle({
  on,
  onToggle,
  disabled,
}: {
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <FieldIndicator
      label={`Case insensitive: ${on ? "ON" : "OFF"}`}
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={on}
      className={clsx("gb-select__toggle", on && "gb-select__toggle--on")}
    >
      <PiTextAaBold />
    </FieldIndicator>
  );
}

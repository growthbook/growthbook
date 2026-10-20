import { PiMagicWandFill } from "react-icons/pi";
import {
  EDITOR_ACTION_ICON_SIZE,
  EditorAction,
} from "@/components/Forms/CodeTextArea";
import { formatJSON } from "@/services/features";

// The editor corner's Format JSON button. Formats only when clicked:
// formatting a large value on every keystroke makes typing lag.
export default function FormatJsonAction({
  value,
  setValue,
}: {
  value: string;
  setValue: (value: string) => void;
}) {
  return (
    <EditorAction
      label="Format JSON"
      icon={
        <PiMagicWandFill
          size={EDITOR_ACTION_ICON_SIZE}
          // It reads small beside the other icons; scaled, the button keeps
          // its size.
          style={{ transform: "scale(1.15)" }}
        />
      }
      onClick={() => {
        const formatted = formatJSON(value);
        if (formatted && formatted !== value) setValue(formatted);
      }}
    />
  );
}

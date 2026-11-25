import { useLingui } from "@lingui/react/macro";
import { EditorAction } from "@/components/Forms/CodeTextArea";
import { FormatJsonIcon } from "@/ui/ActionIcons";
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
  const { t } = useLingui();
  return (
    <EditorAction
      label={t`Format JSON`}
      icon={<FormatJsonIcon size="sm" />}
      onClick={() => {
        const formatted = formatJSON(value);
        if (formatted && formatted !== value) setValue(formatted);
      }}
    />
  );
}

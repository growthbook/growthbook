import { useEffect, useState } from "react";
import { Box } from "@radix-ui/themes";
import { PiMagnifyingGlass } from "react-icons/pi";
import Field from "@/components/Forms/Field";
import styles from "./StreamSearchField.module.scss";

interface Props {
  /** The committed value — what the caller is actually filtering by. */
  value: string;
  /** Fired on commit (blur or Enter), not on every keystroke. */
  onChange: (value: string) => void;
  placeholder?: string;
}

/**
 * Search input with the magnifier sitting inside the field, to the left of the
 * placeholder. Shared by the Event Logs stream and the feature Diagnostics
 * evaluation stream. Field's own `prepend` is not used for this: it renders a
 * Bootstrap `input-group-text`, which draws a bordered grey box beside the
 * input rather than an icon floating within it.
 *
 * Typing only updates local state; the value is committed on blur or Enter, so
 * neither surface re-filters on every keystroke — Event Logs would refetch its
 * summary, and Diagnostics would re-sort and re-page its table under the
 * reader's cursor.
 */
export default function StreamSearchField({
  value,
  onChange,
  placeholder = "Search...",
}: Props) {
  const [draft, setDraft] = useState(value);

  // Keep the box in step when the committed value is changed from elsewhere.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (draft !== value) onChange(draft);
  };

  return (
    <Box position="relative">
      <PiMagnifyingGlass size={15} aria-hidden className={styles.searchIcon} />
      <Field
        placeholder={placeholder}
        type="search"
        containerClassName="mb-0"
        className={styles.searchInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
    </Box>
  );
}

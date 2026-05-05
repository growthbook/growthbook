import { useState, useEffect, useRef, ComponentProps } from "react";
import Field from "@/components/Forms/Field";

/**
 * A wrapper around Field that holds its value in local state and only
 * calls `onCommit` when the user blurs or presses Enter.
 */
export function DeferredField({
  value,
  onCommit,
  ...fieldProps
}: Omit<ComponentProps<typeof Field>, "onChange" | "onBlur" | "onKeyDown"> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [localValue, setLocalValue] = useState(value);
  const localRef = useRef(localValue);

  // Sync from parent when the canonical value changes externally
  useEffect(() => {
    setLocalValue(value);
    localRef.current = value;
  }, [value]);

  const commit = () => {
    onCommit(localRef.current);
  };

  return (
    <Field
      {...fieldProps}
      value={localValue}
      onChange={(e) => {
        const v = e.target.value;
        // For numeric fields, only allow valid partial number input
        if (fieldProps.inputMode === "decimal" && v !== "") {
          if (!/^-?\.?$|^-?\d*\.?\d*$/.test(v)) return;
        }
        localRef.current = v;
        setLocalValue(v);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

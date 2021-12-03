import { FC, useMemo } from "react";
import Field, { FieldProps } from "./Field";
import ReactSelect from "react-select";

const Select: FC<
  Omit<
    FieldProps,
    "value" | "onChange" | "options" | "multi" | "initialOption" | "placeholder"
  > & {
    value: string;
    placeholder?: string;
    options: { label: string; value: string }[];
    initialOption?: string;
    onChange: (value: string) => void;
  }
> = ({
  value,
  options,
  onChange,
  initialOption,
  placeholder = "Select...",
  ...otherProps
}) => {
  const [map, sorted] = useMemo(() => {
    const m = new Map<string, { label: string; value: string }>();
    const sorted = [...options];
    sorted.sort((a, b) => {
      return a.label.localeCompare(b.label);
    });
    sorted.forEach((o) => {
      m.set(o.value, o);
    });
    return [
      m,
      initialOption
        ? [{ label: initialOption, value: "" }].concat(sorted)
        : sorted,
    ];
  }, [options, initialOption]);
  const selected = map.get(value);

  // eslint-disable-next-line
  const fieldProps = otherProps as any;

  return (
    <Field
      {...fieldProps}
      render={(id, ref) => {
        return (
          <ReactSelect
            id={id}
            ref={ref}
            options={sorted}
            onChange={(selected) => {
              onChange(selected?.value || "");
            }}
            value={selected}
            placeholder={initialOption ?? placeholder}
            menuPosition="fixed"
            isSearchable
          />
        );
      }}
    />
  );
};

export default Select;

import { FC, useMemo } from "react";
import Field, { FieldProps } from "./Field";
import ReactSelect from "react-select";

type SingleValue = { label: string; value: string };
type GroupedValue = { label: string; options: SingleValue[] };

const SelectField: FC<
  Omit<
    FieldProps,
    "value" | "onChange" | "options" | "multi" | "initialOption" | "placeholder"
  > & {
    value: string;
    placeholder?: string;
    options: (SingleValue | GroupedValue)[];
    initialOption?: string;
    onChange: (value: string) => void;
    sort?: boolean;
  }
> = ({
  value,
  options,
  onChange,
  initialOption,
  placeholder = "Select...",
  sort = true,
  disabled,
  ...otherProps
}) => {
  const [map, sorted] = useMemo(() => {
    const m = new Map<string, SingleValue>();
    const sorted = [...options];
    sort &&
      sorted.sort((a, b) => {
        return a.label.localeCompare(b.label);
      });
    sorted.forEach((o) => {
      if ((o as GroupedValue).options) {
        (o as GroupedValue).options = [...(o as GroupedValue).options];
        sort &&
          (o as GroupedValue).options.sort((a, b) => {
            return a.label.localeCompare(b.label);
          });
        (o as GroupedValue).options.forEach((option) => {
          m.set(option.value, option);
        });
      } else {
        m.set((o as SingleValue).value, o as SingleValue);
      }
    });

    if (initialOption) {
      sorted.unshift({ label: initialOption, value: "" });
    }

    return [m, sorted];
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
            isDisabled={disabled || false}
            options={sorted}
            onChange={(selected) => {
              onChange(selected?.value || "");
            }}
            styles={{
              menu: (base) => ({
                ...base,
                width: "max-content",
                minWidth: "100%",
              }),
              menuPortal: (base) => ({ ...base, zIndex: 9999 }),
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

export default SelectField;

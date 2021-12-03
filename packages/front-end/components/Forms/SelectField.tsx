import { FC, useMemo } from "react";
import Field, { FieldProps } from "./Field";
import ReactSelect from "react-select";
import cloneDeep from "lodash/cloneDeep";

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
    const clone = cloneDeep(options);
    if (sort) {
      clone.sort((a, b) => {
        return a.label.localeCompare(b.label);
      });
    }
    clone.forEach((o) => {
      if ("options" in o) {
        const suboptions = o.options;
        if (sort) {
          suboptions.sort((a, b) => {
            return a.label.localeCompare(b.label);
          });
        }
        suboptions.forEach((option) => {
          m.set(option.value, option);
        });
      } else {
        m.set(o.value, o);
      }
    });

    if (initialOption) {
      clone.unshift({ label: initialOption, value: "" });
    }

    return [m, clone];
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

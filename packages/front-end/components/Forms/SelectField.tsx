import { FC, useMemo } from "react";
import Field, { FieldProps } from "./Field";
import ReactSelect from "react-select";
import cloneDeep from "lodash/cloneDeep";

export type SingleValue = { label: string; value: string };
export type GroupedValue = { label: string; options: SingleValue[] };

export function useSelectOptions(
  options: (SingleValue | GroupedValue)[],
  initialOption?: string,
  sort?: boolean
) {
  return useMemo(() => {
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

    return [m, clone] as const;
  }, [options, initialOption]);
}

export const ReactSelectProps = {
  styles: {
    menu: (base) => ({
      ...base,
      width: "max-content",
      minWidth: "100%",
    }),
    menuPortal: (base) => ({ ...base, zIndex: 9999 }),
    groupHeading: (base) => ({
      ...base,
      margin: "3px 0 0 -2px",
      fontSize: "70%",
    }),
    group: (base) => ({
      ...base,
      paddingTop: 0,
      paddingBottom: 0,
    }),
    option: (base) => ({
      ...base,
      padding: "6px 17px",
    }),
  },
  menuPosition: "fixed" as const,
  isSearchable: true,
};

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
  autoFocus,
  required,
  ...otherProps
}) => {
  const [map, sorted] = useSelectOptions(options, initialOption, sort);
  const selected = map.get(value);

  // eslint-disable-next-line
  const fieldProps = otherProps as any;

  return (
    <Field
      {...fieldProps}
      render={(id, ref) => {
        return (
          <>
            <div className="d-lg-none">
              <select
                value={selected?.value || ""}
                onChange={(e) => onChange(e.target.value)}
                className="form-control"
                disabled={disabled}
                id={id}
                ref={ref}
                required={required}
                placeholder={initialOption ?? placeholder}
              >
                {sorted.map((s) => {
                  if ("options" in s) {
                    return (
                      <optgroup key={s.label} label={s.label}>
                        {s.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </optgroup>
                    );
                  } else {
                    return (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    );
                  }
                })}
              </select>
            </div>
            <div className="d-none d-lg-block">
              <ReactSelect
                {...ReactSelectProps}
                id={id}
                ref={ref}
                isDisabled={disabled || false}
                options={sorted}
                onChange={(selected) => {
                  onChange(selected?.value || "");
                }}
                autoFocus={autoFocus}
                value={selected}
                placeholder={initialOption ?? placeholder}
              />
            </div>
          </>
        );
      }}
    />
  );
};

export default SelectField;

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
  autoFocus,
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
          <>
            <div className="d-lg-none">
              <select
                value={selected?.value || ""}
                onChange={(e) => onChange(e.target.value)}
                className="form-control"
                disabled={disabled}
                {...fieldProps}
                id={id}
                ref={ref}
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
                }}
                autoFocus={autoFocus}
                value={selected}
                placeholder={initialOption ?? placeholder}
                menuPosition="fixed"
                isSearchable
              />
            </div>
          </>
        );
      }}
    />
  );
};

export default SelectField;

import { FC, useMemo, useRef, ReactNode } from "react";
import ReactSelect from "react-select";
import cloneDeep from "lodash/cloneDeep";
import clsx from "clsx";
import Field, { FieldProps } from "./Field";

export type SingleValue = { label: string; value: string; tooltip?: string };
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
      const o = { label: initialOption, value: "" };
      clone.unshift(o);
      m.set("", o);
    }

    return [m, clone] as const;
  }, [options, initialOption]);
}

export const ReactSelectProps = {
  // See react-select.scss and apply styles with CSS
  styles: {
    multiValue: (styles) => {
      return {
        ...styles,
        backgroundColor: "var(--form-multivalue-background-color)",
      };
    },
    multiValueRemove: (styles) => {
      return {
        ...styles,
        color: "var(--form-multivalue-text-color)",
      };
    },
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
    formatOptionLabel?: (value: SingleValue) => ReactNode;
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
  style,
  className,
  formatOptionLabel,
  ...otherProps
}) => {
  const [map, sorted] = useSelectOptions(options, initialOption, sort);
  const selected = map.get(value);

  // eslint-disable-next-line
  const fieldProps = otherProps as any;

  const selectRef = useRef(null);

  return (
    <Field
      {...fieldProps}
      ref={selectRef}
      render={(id, ref) => {
        return (
          <div
            style={style}
            className={clsx(
              "gb-select-wrapper position-relative",
              disabled ? "disabled" : "",
              className
            )}
          >
            <ReactSelect
              {...ReactSelectProps}
              id={id}
              ref={ref}
              classNamePrefix="gb-select"
              isDisabled={disabled || false}
              options={sorted}
              onChange={(selected) => {
                onChange(selected?.value || "");
              }}
              autoFocus={autoFocus}
              value={selected}
              placeholder={initialOption ?? placeholder}
              formatOptionLabel={formatOptionLabel}
            />
            {required && (
              <input
                tabIndex={-1}
                autoComplete="off"
                style={{
                  opacity: 0,
                  width: "100%",
                  height: 0,
                  position: "absolute",
                  pointerEvents: "none",
                }}
                value={selected?.value || ""}
                onChange={() => {
                  // do nothing
                }}
                onFocus={() => {
                  if (ref?.current) {
                    ref.current.focus();
                  }
                }}
                required
              />
            )}
          </div>
        );
      }}
    />
  );
};

export default SelectField;

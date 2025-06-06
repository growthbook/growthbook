import { FC, useMemo, useRef, ReactNode, useState } from "react";
import ReactSelect, {
  components,
  InputProps,
  FormatOptionLabelMeta,
} from "react-select";
import cloneDeep from "lodash/cloneDeep";
import clsx from "clsx";
import CreatableSelect from "react-select/creatable";
import Field, { FieldProps } from "./Field";

export type SingleValue = { label: string; value: string; tooltip?: string };
export type GroupedValue = { label: string; options: SingleValue[] };
export type Option = SingleValue | GroupedValue;
export function isSingleValue(option: Option): option is SingleValue {
  return typeof (option as SingleValue).value === "string";
}
export type FormatOptionLabelType = (
  value: SingleValue,
  meta: FormatOptionLabelMeta<SingleValue>
) => ReactNode;

export type SelectFieldProps = Omit<
  FieldProps,
  "value" | "onChange" | "options" | "multi" | "initialOption" | "placeholder"
> & {
  value: string;
  markRequired?: boolean;
  placeholder?: string;
  options: (SingleValue | GroupedValue)[];
  initialOption?: string;
  onChange: (value: string) => void;
  sort?: boolean;
  createable?: boolean;
  formatCreateLabel?: (value: string) => string;
  formatOptionLabel?: FormatOptionLabelType;
  formatGroupLabel?: (value: GroupedValue) => ReactNode;
  isSearchable?: boolean;
  isClearable?: boolean;
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  isOptionDisabled?: (_: Option) => boolean;
  forceUndefinedValueToNull?: boolean;
};

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

const Input = (props: InputProps) => {
  // @ts-expect-error will be passed down
  const { onPaste } = props.selectProps;
  return <components.Input onPaste={onPaste} {...props} />;
};

export const ReactSelectProps = {
  // See react-select.scss and apply styles with CSS
  styles: {
    multiValue: (styles) => {
      return {
        ...styles,
        backgroundColor: "var(--form-multivalue-background-color)",
        color: "var(--form-multivalue-text-color) !important",
      };
    },
    multiValueLabel: (styles) => {
      return {
        ...styles,
        color: "var(--form-multivalue-text-color)",
      };
    },
    multiValueRemove: (styles) => {
      return {
        ...styles,
        color: "var(--form-multivalue-text-color)",
      };
    },
    control: (styles, { isFocused }) => {
      return {
        ...styles,
        backgroundColor: "var(--surface-background-color)",
        boxShadow: `0px 0px 0px 1px ${
          isFocused ? "var(--violet-8)" : undefined
        }`,
      };
    },
    menu: (styles) => {
      return {
        ...styles,
        backgroundColor: "var(--surface-background-color)",
      };
    },
    option: (styles, { isFocused }) => {
      return {
        ...styles,
        color: isFocused ? "var(--text-hover-color)" : "var(--text-color-main)",
      };
    },
    input: (styles) => {
      return {
        ...styles,
        color: "var(--text-color-main)",
      };
    },
    singleValue: (styles) => {
      return {
        ...styles,
        color: "var(--text-color-main)",
      };
    },
  },
  menuPosition: "fixed" as const,
  isSearchable: true,
};

const SelectField: FC<SelectFieldProps> = ({
  value,
  options,
  onChange,
  onBlur,
  initialOption,
  placeholder = "Select...",
  sort = true,
  disabled,
  autoFocus,
  required,
  style,
  className,
  createable = false,
  formatCreateLabel,
  formatOptionLabel,
  formatGroupLabel,
  isSearchable = true,
  isClearable = false,
  onPaste,
  isOptionDisabled,
  // forces re-render when input is undefined
  forceUndefinedValueToNull = false,
  ...otherProps
}) => {
  const [map, sorted] = useSelectOptions(options, initialOption, sort);
  let selected = map.get(value);

  if (!selected && value && createable) {
    selected = {
      label: value,
      value: value,
    };
  }

  const [inputValue, setInputValue] = useState("");

  // eslint-disable-next-line
  const fieldProps = otherProps as any;

  const selectRef = useRef(null);

  if (!options.length && createable) {
    return (
      <Field
        {...fieldProps}
        ref={selectRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        required={required}
        className={className}
        onBlur={onBlur}
      />
    );
  }

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
            {createable ? (
              <CreatableSelect
                {...ReactSelectProps}
                id={id}
                ref={ref}
                classNamePrefix="gb-select"
                isClearable={isClearable}
                isDisabled={disabled || false}
                placeholder={placeholder}
                inputValue={inputValue}
                options={sorted}
                formatCreateLabel={formatCreateLabel}
                isValidNewOption={(value) => {
                  if (!otherProps.pattern) return !!value;
                  return new RegExp(otherProps.pattern).test(value);
                }}
                autoFocus={autoFocus}
                onChange={(selected: { value: string }) => {
                  onChange(selected?.value || "");
                  setInputValue("");
                }}
                onFocus={() => {
                  if (!selected?.value || !map.has(selected?.value)) {
                    // If this was a custom option, reset the input value so it's editable
                    setInputValue(selected?.value || "");
                  }
                }}
                onBlur={(e) => {
                  if (!inputValue) return;
                  onChange(inputValue);
                  onBlur && onBlur(e);
                }}
                onInputChange={(val) => {
                  setInputValue(val);
                }}
                onKeyDown={(event) => {
                  if (!inputValue) return;
                  switch (event.key) {
                    case "Enter":
                    case "Tab":
                      onChange(inputValue);
                      setInputValue("");
                      ref.current.blur();
                  }
                }}
                onCreateOption={(val) => {
                  onChange(val);
                }}
                noOptionsMessage={() => null}
                value={selected}
                formatOptionLabel={formatOptionLabel}
                formatGroupLabel={formatGroupLabel}
                isSearchable={!!isSearchable}
                onPaste={onPaste}
                components={{
                  Input,
                }}
                isOptionDisabled={isOptionDisabled}
              />
            ) : (
              <ReactSelect
                {...ReactSelectProps}
                id={id}
                ref={ref}
                isClearable={isClearable}
                classNamePrefix="gb-select"
                isDisabled={disabled || false}
                options={sorted}
                onChange={(selected: { value: string }) => {
                  onChange(selected?.value || "");
                }}
                onBlur={onBlur}
                autoFocus={autoFocus}
                value={forceUndefinedValueToNull ? selected ?? null : selected}
                placeholder={initialOption ?? placeholder}
                formatOptionLabel={formatOptionLabel}
                formatGroupLabel={formatGroupLabel}
                isSearchable={!!isSearchable}
                onPaste={onPaste}
                components={{
                  Input,
                }}
                isOptionDisabled={isOptionDisabled}
              />
            )}
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

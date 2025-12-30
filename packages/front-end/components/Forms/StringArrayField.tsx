import React, { useState } from "react";
import CreatableSelect from "react-select/creatable";
import Field, { FieldProps } from "./Field";
import { ReactSelectProps } from "./SelectField";

const components = {
  DropdownIndicator: null,
};

export type Props = Omit<
  FieldProps,
  "value" | "onChange" | "options" | "multi" | "initialOption"
> & {
  value: string[];
  onChange: (value: string[]) => void;
  delimiters?: string[];
};

const DEFAULT_DELIMITERS = ["Enter", "Tab", " ", ","];

export default function StringArrayField({
  value,
  onChange: origOnChange,
  autoFocus,
  disabled,
  delimiters = DEFAULT_DELIMITERS,
  placeholder,
  pattern,
  ...otherProps
}: Props) {
  const [inputValue, setInputValue] = useState("");

  const onChange = (val: string[]) => {
    // If pattern is specified, filter out invalid entries
    if (pattern) {
      const regex = new RegExp(pattern);
      val = val.filter((v) => regex.test(v));
    }
    origOnChange(val);
  };

  // eslint-disable-next-line
  const fieldProps = otherProps as any;

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!inputValue) return;

    if (delimiters.includes(event.key)) {
      event.preventDefault();
      onChange([...value, inputValue]);
      setInputValue("");
    }
  };

  return (
    <Field
      {...fieldProps}
      render={(id, ref) => {
        return (
          <CreatableSelect
            id={id}
            ref={ref}
            isDisabled={disabled}
            components={components}
            inputValue={inputValue}
            isClearable
            classNamePrefix="gb-select"
            isMulti
            menuIsOpen={false}
            autoFocus={autoFocus}
            getOptionLabel={(option) => option}
            getOptionValue={(option) => option}
            onChange={(val) => onChange(val as string[])}
            onInputChange={(val) => setInputValue(val)}
            onKeyDown={(event) => handleKeyDown(event)}
            onBlur={() => {
              if (!inputValue) return;
              onChange([...value, inputValue]);
              setInputValue("");
            }}
            isValidNewOption={(value) => {
              if (!pattern) return !!value;
              return new RegExp(pattern).test(value);
            }}
            placeholder={placeholder}
            value={value}
            {...ReactSelectProps}
          />
        );
      }}
    />
  );
}

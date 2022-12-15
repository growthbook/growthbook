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
};

export default function StringArrayField({
  value,
  onChange,
  autoFocus,
  disabled,
  placeholder,
  ...otherProps
}: Props) {
  const [inputValue, setInputValue] = useState("");

  // eslint-disable-next-line
  const fieldProps = otherProps as any;

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
            isMulti
            menuIsOpen={false}
            autoFocus={autoFocus}
            getOptionLabel={(option) => option}
            getOptionValue={(option) => option}
            onChange={(val) => onChange(val as string[])}
            onInputChange={(val) => setInputValue(val)}
            onKeyDown={(event) => {
              if (!inputValue) return;
              switch (event.key) {
                case "Enter":
                case "Tab":
                case " ":
                case ",":
                  onChange([...value, inputValue]);
                  setInputValue("");
                  event.preventDefault();
              }
            }}
            onBlur={() => {
              if (!inputValue) return;
              onChange([...value, inputValue]);
              setInputValue("");
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

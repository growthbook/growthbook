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
  onChange,
  autoFocus,
  disabled,
  delimiters = DEFAULT_DELIMITERS,
  placeholder,
  ...otherProps
}: Props) {
  const [inputValue, setInputValue] = useState("");

  // eslint-disable-next-line
  const fieldProps = otherProps as any;

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!inputValue) return;

    if (delimiters.includes(event.key)) {
      event.preventDefault();
      onChange([...value, ...checkForPasteDelimitation(inputValue)]);
      setInputValue("");
    }
  };

  const checkForPasteDelimitation = (val: string) =>
    val.split(/[\s,]/g).filter((e) => e.trim().length > 0);

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
            onKeyDown={(event) => handleKeyDown(event)}
            onBlur={() => {
              if (!inputValue) return;
              console.log("blur called");
              onChange([...value, ...checkForPasteDelimitation(inputValue)]);
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

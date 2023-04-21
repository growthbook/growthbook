import { useMemo, useRef, useState } from "react";
import CreatableSelect from "react-select/creatable";
import Field from "@/components/Forms/Field";

type Option = {
  schemaName: string;
  options: {
    label: string;
    value: string;
    queryValue: string;
  }[];
};

type Props = {
  currentValue: string;
  onChange: (label: string, value?: string) => void;
  placeholder?: string;
  label?: string;
  groupedOptions: Option[];
  helpText?: string;
  required?: boolean;
};

export default function TypeaheadInput({
  currentValue,
  onChange,
  label,
  placeholder,
  groupedOptions,
  helpText,
  required,
}: Props) {
  const [inputValue, setInputValue] = useState("");

  const inputRef = useRef(null);

  const formatGroupLabel = (data: Option) => {
    return (
      <div>
        <span>{data.schemaName}</span>
      </div>
    );
  };

  const getCurrentItem = (inputValue: string) => {
    const value = {
      label: inputValue,
      value: "",
      queryValue: inputValue,
    };

    for (const option of groupedOptions) {
      option.options.forEach((item) => {
        if (item.queryValue === inputValue) {
          value.label = item.label;
          value.value = item.value;
          value.queryValue = item.queryValue;
        }
      });
    }

    return value;
  };

  const currentOption = useMemo(() => {
    if (!currentValue) return undefined;

    const value = {
      label: currentValue,
      value: "",
      queryValue: currentValue,
    };

    for (const option of groupedOptions) {
      option.options.forEach((item) => {
        if (item.queryValue === currentValue) {
          value.label = item.label;
          value.value = item.value;
          value.queryValue = item.queryValue;
        }
      });
    }

    return value;
  }, [currentValue, groupedOptions]);

  return (
    <>
      {groupedOptions.length > 0 ? (
        <Field
          helpText={helpText}
          label={label}
          render={() => {
            return (
              <CreatableSelect
                ref={inputRef}
                isClearable
                placeholder={placeholder}
                inputValue={inputValue}
                options={groupedOptions || []}
                onChange={(val: {
                  label: string;
                  value: string;
                  queryValue: string;
                }) => {
                  if (!val) {
                    onChange("", "");
                  } else {
                    onChange(val.queryValue, val.value);
                  }
                }}
                onBlur={() => {
                  if (!inputValue) return;
                  const currentItem = getCurrentItem(inputValue);
                  onChange(currentItem.label, currentItem.value);
                }}
                onInputChange={(val) => {
                  setInputValue(val);
                }}
                onKeyDown={(event) => {
                  if (!inputValue) return;
                  const currentItem = getCurrentItem(inputValue);
                  switch (event.key) {
                    case "Enter":
                    case "Tab":
                      onChange(currentItem.queryValue, currentItem.value);
                      setInputValue("");
                      inputRef.current.blur();
                  }
                }}
                onCreateOption={(val) => {
                  onChange(val, "");
                }}
                noOptionsMessage={() => null}
                isValidNewOption={() => false}
                value={currentOption}
                menuPosition={"fixed"}
                formatGroupLabel={formatGroupLabel}
              />
            );
          }}
        />
      ) : (
        <Field
          label={label}
          onChange={(e) => onChange(e.target.value, "")}
          required={required}
          type={"text"}
          value={currentValue}
          placeholder={placeholder}
        />
      )}
    </>
  );
}

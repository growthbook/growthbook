import { useRef, useState } from "react";
import CreatableSelect from "react-select/creatable";

type Props = {
  currentValue: string;
  onChange: (label: string, value?: string) => void;
  placeholder?: string;
  label?: string;
  options: { label: string; value: string }[];
};

export default function TypeaheadInput({
  currentValue,
  onChange,
  label,
  placeholder,
  options,
}: Props) {
  const [inputValue, setInputValue] = useState("");

  const inputRef = useRef(null);

  function currentOption(): { label: string; value: string } | undefined {
    if (!currentValue) return undefined;

    return (
      options.find((item) => item.label === currentValue) || {
        label: currentValue,
        value: "",
      }
    );
  }

  return (
    <>
      {label && <label>{label}</label>}
      <CreatableSelect
        ref={inputRef}
        isClearable
        placeholder={placeholder}
        inputValue={inputValue}
        options={
          options.map((t) => {
            return {
              value: t.value,
              label: t.label,
            };
          }) ?? []
        }
        onChange={(val: { label: string; value: string }) => {
          if (!val) {
            onChange("", "");
          } else {
            onChange(val.label, val.value);
          }
        }}
        onBlur={() => {
          if (!inputValue) return;
          const currentItem = options.find(
            (item) => item.label === inputValue
          ) || {
            label: inputValue,
            value: "",
          };
          onChange(currentItem.label, currentItem.value);
        }}
        onInputChange={(val) => {
          setInputValue(val);
        }}
        onKeyDown={(event) => {
          if (!inputValue) return;
          const currentItem = options.find(
            (item) => item.label === inputValue
          ) || {
            label: inputValue,
            value: "",
          };
          switch (event.key) {
            case "Enter":
            case "Tab":
            case " ":
              onChange(currentItem.label, currentItem.value);
              setInputValue("");
              inputRef.current.blur();
          }
        }}
        onCreateOption={(val) => {
          onChange(val, "");
        }}
        noOptionsMessage={() => null}
        isValidNewOption={() => false}
        value={currentOption()}
        menuPosition={"fixed"}
      />
    </>
  );
}

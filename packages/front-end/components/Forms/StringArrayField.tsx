import React, { useState } from "react";
import CreatableSelect from "react-select/creatable";
import { components as SelectComponents } from "react-select";
import TextareaAutosize from "react-textarea-autosize";
import { FaRetweet } from "react-icons/fa";
import { Tooltip } from "@radix-ui/themes";
import Field, { FieldProps } from "./Field";
import { ReactSelectProps } from "./SelectField";

export type Props = Omit<
  FieldProps,
  "value" | "onChange" | "options" | "multi" | "initialOption"
> & {
  value: string[];
  onChange: (value: string[]) => void;
  delimiters?: string[];
  /** When true, shows a token ⇄ raw text mode toggle inside the control and an alternate textarea view. */
  enableRawTextMode?: boolean;
};

const DEFAULT_DELIMITERS = ["Enter", "Tab", " ", ","];

const baseComponents = {
  DropdownIndicator: null,
};

function RawTextModeToggleButton({
  rawTextMode,
  onToggle,
}: {
  rawTextMode: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip
      content={rawTextMode ? "Switch to token mode" : "Switch to raw text mode"}
    >
      <button
        type="button"
        className="gb-select__raw-text-mode-indicator"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }}
      >
        <FaRetweet />
      </button>
    </Tooltip>
  );
}

/** Wrapper that adds a raw-text-mode toggle button when selectProps provides onToggleRawTextMode. */
function IndicatorsContainerWithModeToggle(
  props: React.ComponentProps<typeof SelectComponents.IndicatorsContainer>,
) {
  const selectProps = props.selectProps as unknown as Record<string, unknown>;
  const onToggleRawTextMode = selectProps?.onToggleRawTextMode;
  const showToggle = typeof onToggleRawTextMode === "function";

  if (!showToggle) {
    return <SelectComponents.IndicatorsContainer {...props} />;
  }

  return (
    <SelectComponents.IndicatorsContainer {...props}>
      <RawTextModeToggleButton
        rawTextMode={false}
        onToggle={onToggleRawTextMode as () => void}
      />
      {props.children}
    </SelectComponents.IndicatorsContainer>
  );
}

export default function StringArrayField({
  value,
  onChange: origOnChange,
  autoFocus,
  disabled,
  delimiters = DEFAULT_DELIMITERS,
  placeholder,
  pattern,
  enableRawTextMode = false,
  helpText,
  ...otherProps
}: Props) {
  const [inputValue, setInputValue] = useState("");
  const [rawTextMode, setRawTextMode] = useState(false);

  const showModeToggle = enableRawTextMode;
  const components = showModeToggle
    ? {
        ...baseComponents,
        IndicatorsContainer: IndicatorsContainerWithModeToggle,
      }
    : baseComponents;

  const onChange = (val: string[]) => {
    if (pattern) {
      const regex = new RegExp(pattern);
      val = val.filter((v) => regex.test(v));
    }
    origOnChange(val);
  };

  const handleRawTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const raw = e.target.value;
    if (raw === "") {
      onChange([]);
      return;
    }
    const next = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    onChange(next);
  };

  const rawTextValue = value.join(",");

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
      helpText={
        rawTextMode ? (helpText ?? "Separate values by comma") : helpText
      }
      helpTextClassName="mt-0"
      render={(id, ref) => {
        if (showModeToggle && rawTextMode) {
          return (
            <div
              className="gb-select__control gb-select__raw-text-control"
              ref={ref}
            >
              <div className="gb-select__value-container gb-select__raw-text-value-container">
                <TextareaAutosize
                  id={id}
                  className="form-control gb-select__raw-text-input"
                  value={rawTextValue}
                  onChange={handleRawTextChange}
                  placeholder={placeholder ?? "value 1, value 2, value 3..."}
                  minRows={1}
                  disabled={disabled}
                  required={fieldProps.required}
                  autoFocus={autoFocus}
                  style={{ resize: "none" }}
                />
              </div>
              <div className="gb-select__indicators">
                <RawTextModeToggleButton
                  rawTextMode={true}
                  onToggle={() => setRawTextMode(false)}
                />
              </div>
            </div>
          );
        }

        return (
          <CreatableSelect
            id={id}
            ref={ref}
            isDisabled={disabled}
            components={components}
            onToggleRawTextMode={
              showModeToggle ? () => setRawTextMode(true) : undefined
            }
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
            isValidNewOption={(val) => {
              if (!pattern) return !!val;
              return new RegExp(pattern).test(val);
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

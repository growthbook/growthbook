import React, { useState } from "react";
import CreatableSelect from "react-select/creatable";
import { components as SelectComponents } from "react-select";
import TextareaAutosize from "react-textarea-autosize";
import { PiCopy, PiRepeatBold } from "react-icons/pi";
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
  enableRawTextMode?: boolean;
  removeDuplicates?: boolean;
  showCopyButton?: boolean;
};

const DEFAULT_DELIMITERS = ["Enter", "Tab", " ", ","];

const baseComponents = {
  DropdownIndicator: null,
};

function InputWithPasteHandler(
  props: React.ComponentProps<typeof SelectComponents.Input>,
) {
  const selectProps = props.selectProps as unknown as {
    onPasteCapture?: (event: React.ClipboardEvent) => void;
  };

  return (
    <SelectComponents.Input {...props} onPaste={selectProps.onPasteCapture} />
  );
}

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
        <PiRepeatBold />
      </button>
    </Tooltip>
  );
}

function CopyButton({ value }: { value: string[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const text = value.join(", ");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 750);
    });
  };

  return (
    <Tooltip
      content={copied ? "Copied" : "Copy to clipboard"}
      open={copied ? true : undefined}
    >
      <button
        type="button"
        className="gb-select__copy-button"
        onClick={handleCopy}
      >
        <PiCopy />
      </button>
    </Tooltip>
  );
}

/** Wrapper that adds a raw-text-mode toggle button when selectProps provides onToggleRawTextMode. */
function IndicatorsContainerWithButtons(
  props: React.ComponentProps<typeof SelectComponents.IndicatorsContainer>,
) {
  const selectProps = props.selectProps as unknown as Record<string, unknown>;
  const onToggleRawTextMode = selectProps?.onToggleRawTextMode;
  const showToggle = typeof onToggleRawTextMode === "function";
  const showCopy = selectProps?.showCopyButton === true;
  const value = selectProps?.value as string[] | undefined;

  if (!showToggle && !showCopy) {
    return <SelectComponents.IndicatorsContainer {...props} />;
  }

  return (
    <SelectComponents.IndicatorsContainer {...props}>
      {showCopy && value && <CopyButton value={value} />}
      {showToggle && (
        <RawTextModeToggleButton
          rawTextMode={false}
          onToggle={onToggleRawTextMode as () => void}
        />
      )}
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
  removeDuplicates = true,
  showCopyButton = true,
  helpText,
  ...otherProps
}: Props) {
  const [inputValue, setInputValue] = useState("");
  const [rawTextMode, setRawTextMode] = useState(false);

  const showButtons = enableRawTextMode || showCopyButton;
  const components = {
    ...baseComponents,
    Input: InputWithPasteHandler,
    ...(showButtons
      ? {
          IndicatorsContainer: IndicatorsContainerWithButtons,
        }
      : {}),
  };

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
      if (removeDuplicates && value.includes(inputValue)) {
        setInputValue("");
        return;
      }
      onChange([...value, inputValue]);
      setInputValue("");
    }
  };

  const handlePaste = (event: React.ClipboardEvent) => {
    const pastedText = event.clipboardData.getData("text");
    // Commas mean list entry. Parse list:
    if (pastedText.includes(",")) {
      event.preventDefault();

      let newValues = pastedText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((v) => {
          // pattern validation
          if (!pattern) return true;
          return new RegExp(pattern).test(v);
        });
      if (removeDuplicates) {
        newValues = newValues.filter((v) => !value.includes(v));
      }
      if (newValues.length > 0) {
        onChange([...value, ...newValues]);
      }
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
        if (enableRawTextMode && rawTextMode) {
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
                  placeholder={placeholder ?? "value 1, value 2..."}
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
              enableRawTextMode ? () => setRawTextMode(true) : undefined
            }
            showCopyButton={showCopyButton}
            onPasteCapture={handlePaste}
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
              if (removeDuplicates && value.includes(inputValue)) {
                setInputValue("");
                return;
              }
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

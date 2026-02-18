import React, { useState } from "react";
import CreatableSelect from "react-select/creatable";
import {
  components as SelectComponents,
  ClearIndicatorProps,
  MultiValueRemoveProps,
  InputProps,
  MultiValueGenericProps,
  IndicatorsContainerProps,
} from "react-select";
import TextareaAutosize from "react-textarea-autosize";
import { PiCopy, PiRepeatBold, PiXBold } from "react-icons/pi";
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

const ClearIndicatorFixed =
  SelectComponents.ClearIndicator as unknown as React.FC<
    ClearIndicatorProps<{ value: string; label: string }, true>
  >;

function CustomClearIndicator(
  props: ClearIndicatorProps<{ value: string; label: string }, true>,
) {
  return (
    <ClearIndicatorFixed {...props}>
      <PiXBold />
    </ClearIndicatorFixed>
  );
}

const MultiValueRemoveFixed =
  SelectComponents.MultiValueRemove as unknown as React.FC<MultiValueRemoveProps>;

function CustomMultiValueRemove(props: MultiValueRemoveProps) {
  return (
    <MultiValueRemoveFixed {...props}>
      <PiXBold />
    </MultiValueRemoveFixed>
  );
}

const InputFixed = SelectComponents.Input as unknown as React.FC<InputProps>;

function InputWithPasteHandler(props: InputProps) {
  const selectProps = props.selectProps as unknown as {
    onPasteCapture?: (event: React.ClipboardEvent) => void;
  };

  return <InputFixed {...props} onPaste={selectProps.onPasteCapture} />;
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

const IndicatorsContainerFixed =
  SelectComponents.IndicatorsContainer as unknown as React.FC<IndicatorsContainerProps>;

/** Wrapper that adds a raw-text-mode toggle button when selectProps provides onToggleRawTextMode. */
function IndicatorsContainerWithButtons(props: IndicatorsContainerProps) {
  const selectProps = props.selectProps as unknown as Record<string, unknown>;
  const onToggleRawTextMode = selectProps?.onToggleRawTextMode;
  const showToggle = typeof onToggleRawTextMode === "function";
  const showCopy = selectProps?.showCopyButton === true;
  const value = selectProps?.value as string[] | undefined;

  if (!showToggle && !showCopy) {
    return <IndicatorsContainerFixed {...props} />;
  }

  return (
    <IndicatorsContainerFixed {...props}>
      {showCopy && value && <CopyButton value={value} />}
      {showToggle && (
        <RawTextModeToggleButton
          rawTextMode={false}
          onToggle={onToggleRawTextMode as () => void}
        />
      )}
      {props.children}
    </IndicatorsContainerFixed>
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
    MultiValueLabel: (props: MultiValueGenericProps) => {
      const MultiValueLabelFixed =
        SelectComponents.MultiValueLabel as unknown as React.FC<MultiValueGenericProps>;
      const title = props.data as unknown as string;
      const innerProps = { ...props.innerProps, title };
      return <MultiValueLabelFixed {...props} innerProps={innerProps} />;
    },
    MultiValueRemove: CustomMultiValueRemove,
    ClearIndicator: CustomClearIndicator,
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

    // Try to CSV parse if we detect a delimiter
    if (
      pastedText.includes(",") ||
      pastedText.includes("\t") ||
      pastedText.includes("\n")
    ) {
      event.preventDefault();

      let newValues = pastedText
        .split(/[\t\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((v) => {
          // pattern validation
          if (!pattern) return true;
          return new RegExp(pattern).test(v);
        });

      if (removeDuplicates) {
        // Remove duplicates within pasted values AND against existing values
        const seen = new Set(value);
        newValues = newValues.filter((v) => {
          if (seen.has(v)) return false;
          seen.add(v);
          return true;
        });
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

        // Custom props (onToggleRawTextMode, showCopyButton, onPasteCapture) are passed through
        // selectProps to custom components. We spread them as `any` to bypass react-select's strict typing.
        const customSelectProps = {
          onToggleRawTextMode: enableRawTextMode
            ? () => setRawTextMode(true)
            : undefined,
          showCopyButton,
          onPasteCapture: handlePaste,
        } as Record<string, unknown>;

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
            getOptionLabel={(option: { label: string }) => option.label}
            getOptionValue={(option: { value: string }) => option.value}
            onChange={(val) => onChange(val as unknown as string[])}
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
            {...customSelectProps}
          />
        );
      }}
    />
  );
}

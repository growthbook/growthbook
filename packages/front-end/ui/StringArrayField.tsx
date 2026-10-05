import React, { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import CreatableSelect from "react-select/creatable";
import {
  components as SelectComponents,
  ClearIndicatorProps,
} from "react-select";
import TextareaAutosize from "react-textarea-autosize";
import { PiCopy, PiRepeatBold, PiXBold } from "react-icons/pi";
import { Tooltip } from "@radix-ui/themes";
import Field, { FieldProps } from "@/components/Forms/Field";
import { ReactSelectProps } from "@/components/Forms/SelectField";
import { Size } from "@/ui/sizes";

export type StringArrayFieldSize = Size<"md" | "lg">;

export type Props = Omit<
  FieldProps,
  "value" | "onChange" | "options" | "multi" | "initialOption" | "size"
> & {
  value: string[];
  onChange: (value: string[]) => void;
  delimiters?: string[];
  enableRawTextMode?: boolean;
  removeDuplicates?: boolean;
  showCopyButton?: boolean;
  size?: StringArrayFieldSize;
  /** Preserve the pre-design-system 36px control height. */
  legacyHeight?: boolean;
};

const DEFAULT_DELIMITERS = ["Enter", "Tab", " ", ","];

// Past this many values a list is edited as text: a token per value can't be
// scanned or edited, and thousands of them freeze the page. Crossing it
// switches to text; going back below it never switches back mid-edit.
const RAW_TEXT_AFTER_VALUES = 200;

// Text mode separates values the way the field does: with commas where a comma
// ends a value, otherwise one value per line, so values that may hold a comma
// (row filters, ID lists) stay whole
export function rawTextSeparator(delimiters: string[]): string {
  return !delimiters.includes(",") && delimiters.includes("Enter") ? "\n" : ",";
}

export function parseRawText(raw: string, separator: string): string[] {
  return raw
    .split(separator === "," ? "," : /\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Only a list its own text parses back into opens as text
export function opensAsRawText(value: string[], separator: string): boolean {
  if (value.length <= RAW_TEXT_AFTER_VALUES) return false;
  const parsed = parseRawText(value.join(separator), separator);
  return (
    parsed.length === value.length && parsed.every((v, i) => v === value[i])
  );
}

const baseComponents = {
  DropdownIndicator: null,
};

function CustomClearIndicator(
  props: ClearIndicatorProps<{ value: string; label: string }, true>,
) {
  return (
    <SelectComponents.ClearIndicator {...props}>
      <PiXBold />
    </SelectComponents.ClearIndicator>
  );
}

function CustomMultiValueRemove(
  props: React.ComponentProps<typeof SelectComponents.MultiValueRemove>,
) {
  return (
    <SelectComponents.MultiValueRemove {...props}>
      <PiXBold />
    </SelectComponents.MultiValueRemove>
  );
}

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
  size,
  legacyHeight,
  helpText,
  ...otherProps
}: Props) {
  const resolvedSize = size ?? "md";
  const usesLegacyHeight = legacyHeight ?? size === undefined;
  const styleSize = usesLegacyHeight ? "legacy" : resolvedSize;
  const [inputValue, setInputValue] = useState("");
  const textSeparator = rawTextSeparator(delimiters);
  const tooManyForTokens = useMemo(
    () => opensAsRawText(value, textSeparator),
    [value, textSeparator],
  );
  const [rawTextMode, setRawTextMode] = useState(tooManyForTokens);
  const [focusRawText, setFocusRawText] = useState(false);

  // A paste that crosses the limit moves the edit into the text box
  useEffect(() => {
    if (tooManyForTokens && !rawTextMode) {
      setRawTextMode(true);
      setFocusRawText(true);
    }
  }, [tooManyForTokens, rawTextMode]);

  const showButtons = enableRawTextMode || showCopyButton;
  const components = {
    ...baseComponents,
    Input: InputWithPasteHandler,
    MultiValueLabel: (
      props: React.ComponentProps<typeof SelectComponents.MultiValueLabel>,
    ) => {
      const title = props.data as string;
      const innerProps = { ...props.innerProps, title };
      return (
        <SelectComponents.MultiValueLabel {...props} innerProps={innerProps} />
      );
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

  // The text as typed while editing; parsing drops empty entries, so text
  // rebuilt from the list would eat a trailing comma before the next value
  const [rawTextDraft, setRawTextDraft] = useState<string | null>(null);
  const setRawText = (raw: string) => {
    setRawTextDraft(raw);
    onChange(parseRawText(raw, textSeparator));
  };
  // Inserts at the caret like typing, so the caret and undo history hold
  const insertRawText = (target: HTMLTextAreaElement, text: string): void => {
    if (document.execCommand("insertText", false, text)) return;
    setRawText(
      target.value.slice(0, target.selectionStart) +
        text +
        target.value.slice(target.selectionEnd),
    );
  };

  const rawTextValue = rawTextDraft ?? value.join(textSeparator);
  // Pasted lines and tabs become separators when Enter and Tab end a token, as
  // a paste in token mode splits them; typed text splits on the separator only,
  // so stored values that contain anything else stay whole
  const handleRawTextPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const separators = `${delimiters.includes("Enter") ? "\n" : ""}${
      delimiters.includes("Tab") ? "\t" : ""
    }`;
    const pasted = e.clipboardData.getData("text");
    if (!separators || !new RegExp(`[${separators}]`).test(pasted)) return;
    e.preventDefault();
    // Empty entries from leading or doubled separators are dropped on parse
    insertRawText(
      e.currentTarget,
      pasted.replace(new RegExp(`\r?[${separators}]+`, "g"), textSeparator),
    );
  };
  // Enter ends a value here too when it does in token mode; one value per
  // line already gets that from the textarea
  const handleRawTextKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (e.key !== "Enter" || !delimiters.includes("Enter")) return;
    if (textSeparator !== ",") return;
    e.preventDefault();
    insertRawText(e.currentTarget, ",");
  };

  const sizeStyles = useMemo(() => {
    const sizeMinHeight: Record<StringArrayFieldSize, number> = {
      md: 32,
      lg: 40,
    };
    const sizeVPadding: Record<StringArrayFieldSize, number> = {
      md: 0,
      lg: 4,
    };
    return {
      ...ReactSelectProps.styles,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      control: (base: any, state: any) => ({
        ...ReactSelectProps.styles.control(base, state),
        minHeight: usesLegacyHeight ? 36 : sizeMinHeight[resolvedSize],
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      valueContainer: (base: any) => ({
        ...base,
        paddingTop: usesLegacyHeight ? 2 : sizeVPadding[resolvedSize],
        paddingBottom: usesLegacyHeight ? 2 : sizeVPadding[resolvedSize],
      }),
    };
  }, [resolvedSize, usesLegacyHeight]);

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
        rawTextMode
          ? (helpText ??
            (textSeparator === ","
              ? "Separate values by comma"
              : "One value per line"))
          : helpText
      }
      helpTextClassName="mt-0"
      render={(id, ref) => {
        if (rawTextMode) {
          return (
            <div
              className={clsx(
                "gb-select-wrapper position-relative",
                `gb-select-wrapper--${styleSize}`,
              )}
            >
              <div
                className="gb-select__control gb-select__raw-text-control"
                ref={ref}
              >
                <div className="gb-select__value-container gb-select__raw-text-value-container">
                  <TextareaAutosize
                    id={id}
                    className="form-control gb-select__raw-text-input"
                    value={rawTextValue}
                    onChange={(e) => setRawText(e.target.value)}
                    onPaste={handleRawTextPaste}
                    onKeyDown={handleRawTextKeyDown}
                    onBlur={() => setRawTextDraft(null)}
                    placeholder={
                      placeholder ??
                      (textSeparator === ","
                        ? "value 1, value 2..."
                        : "value 1\nvalue 2...")
                    }
                    minRows={1}
                    maxRows={10}
                    disabled={disabled}
                    required={fieldProps.required}
                    autoFocus={autoFocus || focusRawText}
                    style={{ resize: "none" }}
                  />
                </div>
                {!tooManyForTokens && (
                  <div className="gb-select__indicators">
                    <RawTextModeToggleButton
                      rawTextMode={true}
                      onToggle={() => setRawTextMode(false)}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        }

        return (
          <div
            className={clsx(
              "gb-select-wrapper position-relative",
              `gb-select-wrapper--${styleSize}`,
            )}
          >
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
              styles={sizeStyles}
            />
          </div>
        );
      }}
    />
  );
}

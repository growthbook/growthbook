import { FC, MouseEventHandler, ReactNode, useState } from "react";
import ReactSelect, {
  components,
  MultiValueGenericProps,
  MultiValueProps,
  InputProps,
  Props,
  StylesConfig,
  OptionProps,
  FormatOptionLabelMeta,
  ClearIndicatorProps,
} from "react-select";
import {
  SortableContainer,
  SortableContainerProps,
  SortableElement,
  SortEndHandler,
  SortableHandle,
} from "react-sortable-hoc";
import { arrayMove } from "@dnd-kit/sortable";
import CreatableSelect from "react-select/creatable";
import { isDefined } from "shared/util";
import clsx from "clsx";
import { PiCopy, PiXBold } from "react-icons/pi";
import { Tooltip } from "@radix-ui/themes";
import {
  ReactSelectProps,
  SingleValue,
  Option,
  GroupedValue,
  useSelectOptions,
} from "@/components/Forms/SelectField";
import Field, { FieldProps } from "@/components/Forms/Field";
import { ColorOption } from "@/components/Tags/TagsInput";

const SortableMultiValue = SortableElement(
  (props: MultiValueProps<SingleValue>) => {
    // Hack to stop the dropdown from opening when the user starts dragging
    const onMouseDown: MouseEventHandler<HTMLDivElement> = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const innerProps = { ...props.innerProps, onMouseDown };
    // @ts-expect-error TS(2322) If you come across this, please fix it!: Type '{ innerProps: { onMouseDown: MouseEventHandl... Remove this comment to see the full error message
    return <components.MultiValue {...props} innerProps={innerProps} />;
  },
);

// eslint-disable-next-line
const SortableMultiValueLabel = SortableHandle<any>(
  (props: MultiValueGenericProps) => {
    const title = props.data?.tooltip || props.data?.label || "";
    const innerProps = { ...props.innerProps, title };
    return <components.MultiValueLabel {...props} innerProps={innerProps} />;
  },
);

const OptionWithTitle = (props: OptionProps<SingleValue>) => {
  // @ts-expect-error TS(2322) If you come across this, please fix it!: Type '{ children: ReactNode; innerRef: (instance: ... Remove this comment to see the full error message
  const option = <components.Option {...props} />;
  return <div title={props.data?.tooltip}>{option}</div>;
};

const SortableSelect = SortableContainer(ReactSelect) as React.ComponentClass<
  Props<SingleValue, true> & SortableContainerProps
>;

const SortableCreatableSelect = SortableContainer(
  CreatableSelect,
) as React.ComponentClass<Props<SingleValue, true> & SortableContainerProps>;

const Input = (props: InputProps) => {
  // @ts-expect-error will be passed down
  const { onPaste } = props.selectProps;
  return <components.Input onPaste={onPaste} {...props} />;
};

function CopyButton({ value }: { value: string[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const text = JSON.stringify(value);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 750);
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <Tooltip
      content={copied ? "Copied" : "Copy to clipboard"}
      open={copied ? true : undefined}
    >
      <button
        type="button"
        className="gb-multi-select__copy-button"
        onClick={handleCopy}
        onMouseDown={handleMouseDown}
      >
        <PiCopy />
      </button>
    </Tooltip>
  );
}

function IndicatorsContainerWithCopyButton(
  props: React.ComponentProps<typeof components.IndicatorsContainer>,
) {
  const selectProps = props.selectProps as unknown as {
    showCopyButton?: boolean;
    value?: Array<{ value: string; label: string }>;
  };

  const showCopy = selectProps?.showCopyButton === true;
  const options = selectProps?.value;

  if (!showCopy || !options || options.length === 0) {
    return <components.IndicatorsContainer {...props} />;
  }

  // Extract just the value strings from the option objects
  const values = options.map((opt) => opt.value);

  return (
    <components.IndicatorsContainer {...props}>
      <CopyButton value={values} />
      {props.children}
    </components.IndicatorsContainer>
  );
}

function CustomClearIndicator(props: ClearIndicatorProps<ColorOption, true>) {
  return (
    <components.ClearIndicator {...props}>
      <PiXBold />
    </components.ClearIndicator>
  );
}

function CustomMultiValueRemove(
  props: React.ComponentProps<typeof components.MultiValueRemove>,
) {
  return (
    <components.MultiValueRemove {...props}>
      <PiXBold />
    </components.MultiValueRemove>
  );
}

export type MultiSelectFieldProps = Omit<
  FieldProps,
  "value" | "onChange" | "options" | "multi" | "initialOption" | "placeholder"
> & {
  value: string[];
  placeholder?: string;
  options: (Option | GroupedValue)[];
  initialOption?: string;
  onChange: (value: string[]) => void;
  sort?: boolean;
  customStyles?: StylesConfig<ColorOption, true>;
  customClassName?: string;
  closeMenuOnSelect?: boolean;
  creatable?: boolean;
  formatOptionLabel?: (
    value: SingleValue,
    meta: FormatOptionLabelMeta<SingleValue>,
  ) => ReactNode;
  formatGroupLabel?: (value: GroupedValue) => ReactNode;
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  isOptionDisabled?: (_: Option) => boolean;
  noMenu?: boolean;
  showCopyButton?: boolean;
};

const MultiSelectField: FC<MultiSelectFieldProps> = ({
  value,
  options,
  onChange,
  initialOption,
  placeholder = "Select...",
  sort = true,
  disabled,
  autoFocus,
  customStyles,
  customClassName,
  creatable,
  closeMenuOnSelect = false,
  formatOptionLabel,
  formatGroupLabel,
  onPaste: userOnPaste,
  isOptionDisabled,
  noMenu,
  required,
  pattern,
  showCopyButton = true,
  ...otherProps
}) => {
  const [map, sorted] = useSelectOptions(options, initialOption, sort);
  const selected = value.map((v) => map.get(v)).filter(isDefined);

  // eslint-disable-next-line
  const fieldProps = otherProps as any;

  const Component = creatable ? SortableCreatableSelect : SortableSelect;

  const handlePaste =
    userOnPaste ??
    ((event: React.ClipboardEvent<HTMLInputElement>) => {
      const clipboard = event.clipboardData;
      const pastedText = clipboard.getData("text").trim();
      let parsed: unknown;

      // Normalize to have brackets, then try JSON parse
      let normalizedText = pastedText;
      if (!normalizedText.startsWith("["))
        normalizedText = "[" + normalizedText;
      if (!normalizedText.endsWith("]")) normalizedText = normalizedText + "]";

      try {
        parsed = JSON.parse(normalizedText);
      } catch {
        // do nothing
      }

      // If JSON parsing failed, try splitting by delimiters
      if (!Array.isArray(parsed)) {
        // Split by comma, tab, or newline
        const items = pastedText
          .split(/[\t\n,]+/)
          .map((s) => s.trim().replace(/^["'[]|["'\]]$/g, "")) // Remove quotes and brackets
          .filter(Boolean);

        if (items.length > 0) {
          parsed = items;
        }
      }

      if (Array.isArray(parsed)) {
        let newValues = parsed
          .map((v) => String(v))
          .filter(Boolean)
          .filter((v) => {
            if (!pattern) return true;
            return new RegExp(pattern).test(v);
          })
          .filter((v) => {
            if (creatable) return true;
            return map.has(v);
          });

        // Remove duplicates within pasted values AND against existing values
        const seen = new Set(value);
        newValues = newValues.filter((v) => {
          if (seen.has(v)) return false;
          seen.add(v);
          return true;
        });

        if (newValues.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          onChange([...value, ...newValues]);
        }
      }
    });

  const onSortEnd: SortEndHandler = ({ oldIndex, newIndex }) => {
    onChange(
      arrayMove(
        selected.map((v) => v.value),
        oldIndex,
        newIndex,
      ),
    );
  };
  const mergeStyles = customStyles
    ? {
        styles: {
          ...ReactSelectProps.styles,
          ...customStyles,
        },
      }
    : {};
  return (
    <Field
      {...fieldProps}
      customClassName={clsx(customClassName, { "cursor-disabled": disabled })}
      render={(id, ref) => {
        return (
          <div style={{ position: "relative" }}>
            <Component
              onPaste={handlePaste}
              showCopyButton={showCopyButton}
              useDragHandle
              classNamePrefix="gb-multi-select"
              helperClass="multi-select-container"
              axis="xy"
              onSortEnd={(s, e) => {
                onSortEnd(s, e);
                // The following is a hack to clean up elements that might be
                // left in the dom after dragging. Hopefully we can remove this
                // if react-select and react-sortable fixes it.
                setTimeout(() => {
                  const nodes = document.querySelectorAll(
                    "body > .multi-select-container",
                  );
                  nodes.forEach((n) => {
                    n.remove();
                  });
                }, 100);
              }}
              distance={4}
              getHelperDimensions={({ node }) => node.getBoundingClientRect()}
              id={id}
              ref={ref}
              formatOptionLabel={formatOptionLabel}
              formatGroupLabel={formatGroupLabel}
              isDisabled={disabled || false}
              options={sorted}
              isMulti={true}
              onChange={(selected) => {
                onChange(selected?.map((s) => s.value) ?? []);
              }}
              isValidNewOption={(value) => {
                if (!pattern) return !!value;
                return new RegExp(pattern).test(value);
              }}
              components={{
                MultiValue: SortableMultiValue,
                MultiValueLabel: SortableMultiValueLabel,
                MultiValueRemove: CustomMultiValueRemove,
                Option: OptionWithTitle,
                Input,
                ClearIndicator: CustomClearIndicator,
                ...(showCopyButton
                  ? { IndicatorsContainer: IndicatorsContainerWithCopyButton }
                  : {}),
                ...(creatable && noMenu
                  ? {
                      Menu: () => null,
                      DropdownIndicator: () => null,
                      IndicatorSeparator: () => null,
                    }
                  : creatable
                    ? {
                        IndicatorSeparator: () => null,
                        MenuList: (props) => {
                          return (
                            <>
                              <div
                                className="px-2 py-1"
                                style={{
                                  fontWeight: 500,
                                  fontSize: "85%",
                                }}
                              >
                                <strong>Select an option or create one</strong>
                              </div>
                              <components.MenuList {...props} />
                            </>
                          );
                        },
                      }
                    : {
                        IndicatorSeparator: () => null,
                      }),
              }}
              {...(creatable && noMenu
                ? {
                    // Prevent multi-select from submitting if you type the same value twice
                    onKeyDown: (e) => {
                      const v = (e.target as HTMLInputElement).value;
                      if (e.code === "Enter" && (!v || value.includes(v))) {
                        e.preventDefault();
                      }
                    },
                  }
                : {})}
              closeMenuOnSelect={closeMenuOnSelect}
              autoFocus={autoFocus}
              value={selected}
              {...(creatable
                ? {
                    formatCreateLabel: (input: string) => {
                      return (
                        <span>
                          <span className="text-muted">Create</span>{" "}
                          <span
                            className="badge bg-purple-light-2"
                            style={{
                              fontWeight: 600,
                              padding: "3px 6px",
                              lineHeight: "1.5",
                              borderRadius: "2px",
                            }}
                          >
                            {input}
                          </span>
                        </span>
                      );
                    },
                  }
                : {})}
              placeholder={initialOption ?? placeholder}
              isOptionDisabled={isOptionDisabled}
              {...{ ...ReactSelectProps, ...mergeStyles }}
            />
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
                value={value.join(",")}
                onChange={() => {}}
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

export default MultiSelectField;

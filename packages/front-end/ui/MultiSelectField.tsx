import {
  createContext,
  FC,
  MouseEventHandler,
  ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";
import ReactSelect, {
  components,
  GroupBase,
  MultiValueGenericProps,
  MultiValueProps,
  InputProps,
  Props,
  StylesConfig,
  OptionProps,
  FormatOptionLabelMeta,
  ClearIndicatorProps,
  DropdownIndicatorProps,
} from "react-select";
import {
  SortableContainer,
  SortableContainerProps,
  SortableElement,
  SortEndHandler,
} from "react-sortable-hoc";
import { arrayMove } from "@dnd-kit/sortable";
import CreatableSelect from "react-select/creatable";
import { isDefined } from "shared/util";
import clsx from "clsx";
import { PiCaretDown, PiCopy, PiX } from "react-icons/pi";
import { Tooltip } from "@radix-ui/themes";
import Text, { TextSizes, TextWeights } from "@/ui/Text";
import Badge from "@/ui/Badge";
import {
  ReactSelectProps,
  SingleValue,
  Option,
  GroupedValue,
  useSelectOptions,
} from "@/components/Forms/SelectField";
import Field, { FieldProps } from "@/components/Forms/Field";
import HelperText from "@/ui/HelperText";
import { ColorOption } from "@/components/Tags/TagsInput";

type MultiValueLabelStyle = {
  fontSize: string;
  fontWeight: number;
  cursor: string | undefined;
};
const MultiValueLabelStyleContext = createContext<MultiValueLabelStyle>({
  fontSize: "12px",
  fontWeight: 500,
  cursor: undefined,
});

const SortableMultiValue = SortableElement(
  (props: MultiValueProps<SingleValue, true, GroupBase<SingleValue>>) => {
    // Hack to stop the dropdown from opening when the user starts dragging
    const onMouseDown: MouseEventHandler<HTMLDivElement> = (e) => {
      e.preventDefault();
    };
    const innerProps = { ...props.innerProps, onMouseDown };
    return <components.MultiValue {...props} innerProps={innerProps} />;
  },
);

// Not a SortableHandle — the whole tag is the drag target (avoids useDragHandle
// registration issues on first interaction). Cursor is set via context/CSS.
const SortableMultiValueLabel = (
  props: MultiValueGenericProps<SingleValue, true, GroupBase<SingleValue>>,
) => {
  const style = useContext(MultiValueLabelStyleContext);
  const title = props.data?.tooltip || props.data?.label || "";
  const innerProps = { ...props.innerProps, title };
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        alignSelf: "stretch",
        ...style,
      }}
    >
      <components.MultiValueLabel {...props} innerProps={innerProps} />
    </span>
  );
};

const OptionWithTitle = (
  props: OptionProps<SingleValue, true, GroupBase<SingleValue>>,
) => {
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

// Hide heading only for the first *visible* group when its label is empty.
// If the first group has all options selected (group hidden), the second group
// becomes the first visible one and should not show an empty heading either.
function GroupHeading(
  props: React.ComponentProps<typeof components.GroupHeading>,
) {
  const group = props.data as GroupedValue;
  const label = group?.label;
  const selectProps = props.selectProps as {
    options?: GroupedValue[];
    value?: SingleValue[];
  };
  const options = selectProps?.options ?? [];
  const selectedSet = new Set(
    (selectProps?.value ?? []).map((v) => v?.value).filter(Boolean),
  );
  const firstVisibleGroup = options.find((g) =>
    (g?.options ?? []).some((opt) => opt.value && !selectedSet.has(opt.value)),
  );
  const isFirstVisibleGroup = firstVisibleGroup === group;
  const hasLabel = label && label !== "";
  if (isFirstVisibleGroup && !hasLabel) return null;
  return (
    <components.GroupHeading
      {...props}
      className={clsx(
        props.className,
        !hasLabel && "gb-select__group-heading--empty",
      )}
    />
  );
}

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
      <PiX />
    </components.ClearIndicator>
  );
}

function CustomMultiValueRemove(
  props: React.ComponentProps<typeof components.MultiValueRemove>,
) {
  return (
    <span style={{ display: "flex", alignSelf: "stretch" }}>
      <components.MultiValueRemove
        {...props}
        innerProps={{
          ...props.innerProps,
          style: {
            alignSelf: "stretch",
            display: "flex",
            alignItems: "center",
          },
        }}
      >
        <PiX size={14} />
      </components.MultiValueRemove>
    </span>
  );
}

function CustomDropdownIndicator(
  props: DropdownIndicatorProps<SingleValue, true, GroupBase<SingleValue>>,
) {
  return (
    <components.DropdownIndicator {...props}>
      <PiCaretDown size={16} />
    </components.DropdownIndicator>
  );
}

export type MultiSelectFieldProps = Omit<
  FieldProps,
  | "value"
  | "onChange"
  | "options"
  | "multi"
  | "initialOption"
  | "placeholder"
  | "size"
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
  size?: "small" | "legacy" | "medium";
  labelSize?: TextSizes;
  labelWeight?: TextWeights;
  errorLevel?: "error" | "warning";
  legacyLabelFormatting?: boolean;
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
  size = "legacy" as "small" | "legacy" | "medium",
  labelSize,
  labelWeight = "semibold",
  errorLevel = "error",
  legacyLabelFormatting = true,
  ...otherProps
}) => {
  const [map, sorted] = useSelectOptions(options, initialOption, sort);
  // Creatable values may not exist in `options`; keep them as chips rather than dropping them.
  const selected = value
    .map((v) => map.get(v) ?? (creatable ? { label: v, value: v } : undefined))
    .filter(isDefined);

  const { ref: _ref, error, label, ...fieldPropsRest } = otherProps;
  const fieldProps = fieldPropsRest as Omit<
    FieldProps,
    | "value"
    | "onChange"
    | "options"
    | "multi"
    | "initialOption"
    | "placeholder"
    | "render"
    | "ref"
  >;
  if (legacyLabelFormatting) {
    fieldProps.label = label;
  }

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
  const mergeStyles = useMemo(() => {
    const sizeMinHeight: Record<string, number> = {
      small: 32,
      legacy: 36,
      medium: 40,
    };
    const sizeVPadding: Record<string, number> = {
      small: 0,
      legacy: 2,
      medium: 4,
    };
    return {
      styles: {
        ...ReactSelectProps.styles,
        ...(customStyles || {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        control: (base: any, state: any) => ({
          ...(customStyles?.control
            ? customStyles.control(
                ReactSelectProps.styles.control(base, state),
                state,
              )
            : ReactSelectProps.styles.control(base, state)),
          minHeight: sizeMinHeight[size],
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        valueContainer: (base: any) => ({
          ...base,
          paddingTop: sizeVPadding[size],
          paddingBottom: sizeVPadding[size],
        }),
      },
    };
  }, [size, customStyles]);

  const labelStyle = useMemo<MultiValueLabelStyle>(
    () => ({
      fontSize: size === "medium" ? "14px" : "12px",
      fontWeight: 500,
      cursor: sort ? "grab" : undefined,
    }),
    [size, sort],
  );
  return (
    <MultiValueLabelStyleContext.Provider value={labelStyle}>
      <Field
        {...fieldProps}
        customClassName={clsx(customClassName, {
          "cursor-disabled": disabled,
        })}
        render={(id, ref) => {
          return (
            <>
              {!legacyLabelFormatting &&
                label !== undefined &&
                (typeof label === "string" ? (
                  <Text
                    as="label"
                    htmlFor={id}
                    size={labelSize ?? "medium"}
                    weight={labelWeight}
                  >
                    {label}
                  </Text>
                ) : (
                  label
                ))}
              <div style={{ position: "relative" }}>
                <Component
                  className={clsx(`gb-multi-select--${size}`, {
                    error: !!error && errorLevel === "error",
                    warning: !!error && errorLevel === "warning",
                  })}
                  onPaste={handlePaste}
                  showCopyButton={showCopyButton}
                  classNamePrefix="gb-multi-select"
                  helperClass={`multi-select-container gb-multi-select--${size}`}
                  axis="xy"
                  shouldCancelStart={() => !sort}
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
                  getHelperDimensions={({ node }) =>
                    node.getBoundingClientRect()
                  }
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
                    GroupHeading,
                    ...(showCopyButton
                      ? {
                          IndicatorsContainer:
                            IndicatorsContainerWithCopyButton,
                        }
                      : {}),
                    ...(creatable && noMenu
                      ? {
                          Menu: () => null,
                          DropdownIndicator: () => null,
                          IndicatorSeparator: () => null,
                        }
                      : creatable
                        ? {
                            DropdownIndicator: CustomDropdownIndicator,
                            IndicatorSeparator: () => null,
                            MenuList: (props) => {
                              return (
                                <>
                                  <div
                                    style={{
                                      fontWeight: 500,
                                      fontSize: "var(--font-size-1)",
                                      marginLeft: "var(--space-2)",
                                      marginRight: "var(--space-2)",
                                      marginTop: "var(--space-2)",
                                      marginBottom: "var(--space-1)",
                                    }}
                                  >
                                    Select an option or create one
                                  </div>
                                  <components.MenuList {...props} />
                                </>
                              );
                            },
                          }
                        : {
                            DropdownIndicator: CustomDropdownIndicator,
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
                              <Text as="span" color="text-mid">
                                Create
                              </Text>{" "}
                              <Badge
                                color="violet"
                                variant="soft"
                                radius="small"
                                label={input}
                              />
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
              {error && (
                <HelperText status={errorLevel} mt="1">
                  {error}
                </HelperText>
              )}
            </>
          );
        }}
      />
    </MultiValueLabelStyleContext.Provider>
  );
};

export default MultiSelectField;

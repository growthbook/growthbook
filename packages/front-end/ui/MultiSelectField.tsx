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
  CSSObjectWithLabel,
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
  FilterOptionOption,
  ActionMeta,
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
import { PiCaretDown, PiX } from "react-icons/pi";
import { Tooltip } from "@radix-ui/themes";
import VirtualizedMenuList from "@/components/Forms/VirtualizedMenuList";
import Text, { TextSizes, TextWeights } from "@/ui/Text";
import { CopyIcon } from "@/ui/ActionIcons";
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
import { Size } from "@/ui/sizes";
import { ColorOption } from "@/components/Tags/TagsInput";

type MultiValueLabelStyle = {
  fontSize: string;
  fontWeight: number;
  cursor: string | undefined;
  title: boolean;
};
const MultiValueLabelStyleContext = createContext<MultiValueLabelStyle>({
  fontSize: "12px",
  fontWeight: 500,
  cursor: undefined,
  title: true,
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
  const { title: showTitle, ...style } = useContext(
    MultiValueLabelStyleContext,
  );
  // With valueTitles off, the label's own content (e.g. a hover card) owns hover.
  const tooltip = showTitle ? props.data?.tooltip : undefined;
  const innerProps =
    showTitle && !tooltip
      ? { ...props.innerProps, title: props.data?.label || "" }
      : props.innerProps;
  const label = (
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
  return tooltip ? <Tooltip content={tooltip}>{label}</Tooltip> : label;
};

// Whether a menu row reads as selected, when that isn't just its value being picked.
const OptionCheckedContext = createContext<((value: string) => boolean) | null>(
  null,
);

const OptionWithTooltip = (
  props: OptionProps<SingleValue, true, GroupBase<SingleValue>>,
) => {
  const isChecked = useContext(OptionCheckedContext);
  const innerProps = isChecked
    ? { ...props.innerProps, "aria-selected": isChecked(props.data.value) }
    : props.innerProps;
  const tooltip = props.data?.tooltip;
  if (!tooltip) return <components.Option {...props} innerProps={innerProps} />;
  // Anchored to the label, not the full-width row, so the tooltip sits beside
  // the text and stays out of the way while moving down the list.
  return (
    <components.Option {...props} innerProps={innerProps}>
      <Tooltip content={tooltip} side="right">
        <span style={{ display: "inline-block" }}>{props.children}</span>
      </Tooltip>
    </components.Option>
  );
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
        <CopyIcon />
      </button>
    </Tooltip>
  );
}

function IndicatorsContainerWithExtras(
  props: React.ComponentProps<typeof components.IndicatorsContainer>,
) {
  const selectProps = props.selectProps as unknown as {
    showCopyButton?: boolean;
    extraIndicator?: ReactNode;
    value?: Array<{ value: string; label: string }>;
  };

  const options = selectProps?.value;
  const values = options?.map((opt) => opt.value) ?? [];
  const showCopy = selectProps?.showCopyButton === true && values.length > 0;
  const extra = selectProps?.extraIndicator;

  if (!showCopy && !extra) {
    return <components.IndicatorsContainer {...props} />;
  }

  return (
    <components.IndicatorsContainer {...props}>
      {extra}
      {showCopy ? <CopyButton value={values} /> : null}
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
  // Nothing to remove from a field that can't change.
  if (props.selectProps.isDisabled) return null;
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

export type MultiSelectFieldSize = Size<"md" | "lg">;

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
  // `action` tells removing a chip apart from picking in the menu.
  onChange: (
    value: string[],
    action?: ActionMeta<SingleValue>["action"],
  ) => void;
  /** Sorts the menu options and lets selected chips be dragged to reorder. */
  sort?: boolean;
  /** Overrides `sort` for the menu only, so chips stay draggable. */
  sortOptions?: boolean;
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
  /** Keep chosen options in the menu (e.g. to show checkmarks) instead of hiding them. */
  hideSelectedOptions?: boolean;
  /** Whether a menu row is announced as selected, when rows can be covered by other picks. */
  isOptionChecked?: (value: string) => boolean;
  filterOption?: (
    option: FilterOptionOption<SingleValue>,
    inputValue: string,
  ) => boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  noMenu?: boolean;
  showCopyButton?: boolean;
  /** Rendered before the copy button and dropdown caret. */
  extraIndicator?: ReactNode;
  size?: MultiSelectFieldSize;
  /** Preserve the pre-design-system 36px control height. */
  legacyHeight?: boolean;
  /** Tallest the open menu grows before it scrolls, in px (default 300). */
  maxMenuHeight?: number;
  /** Names the control when its visible label isn't the `label` prop. */
  "aria-label"?: string;
  /** Hover text on each chosen value: its tooltip, or else its name. */
  valueTitles?: boolean;
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
  sortOptions = sort,
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
  hideSelectedOptions,
  isOptionChecked,
  filterOption,
  onKeyDown,
  noMenu,
  required,
  pattern,
  showCopyButton = true,
  extraIndicator,
  size,
  legacyHeight,
  maxMenuHeight,
  "aria-label": ariaLabel,
  valueTitles = true,
  labelSize,
  labelWeight = "semibold",
  errorLevel = "error",
  legacyLabelFormatting = true,
  ...otherProps
}) => {
  const resolvedSize = size ?? "md";
  const usesLegacyHeight = legacyHeight ?? size === undefined;
  const styleSize = usesLegacyHeight ? "legacy" : resolvedSize;
  const [map, sorted] = useSelectOptions(options, initialOption, sortOptions);
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
        const known = parsed
          .map((v) => String(v))
          .filter(Boolean)
          .filter((v) => {
            if (!pattern) return true;
            return new RegExp(pattern).test(v);
          })
          .filter((v) => creatable || map.has(v));
        // Values it knows are taken as values, even any it can't add, rather
        // than left as search text.
        if (!known.length) return;
        event.preventDefault();
        event.stopPropagation();

        // A disabled option can't be picked, so it can't be pasted either; nor
        // a value it already has, or one pasted twice.
        const seen = new Set(value);
        const newValues = known.filter((v) => {
          const option = map.get(v);
          if (option && isOptionDisabled?.(option)) return false;
          if (seen.has(v)) return false;
          seen.add(v);
          return true;
        });
        if (newValues.length > 0) onChange([...value, ...newValues]);
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
    const sizeMinHeight: Record<MultiSelectFieldSize, number> = {
      md: 32,
      lg: 40,
    };
    const sizeVPadding: Record<MultiSelectFieldSize, number> = {
      md: 0,
      lg: 4,
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
          minHeight: usesLegacyHeight ? 36 : sizeMinHeight[resolvedSize],
        }),
        multiValueLabel: (
          base: CSSObjectWithLabel,
          state: MultiValueProps<ColorOption, true, GroupBase<ColorOption>>,
        ) => {
          const styled = customStyles?.multiValueLabel
            ? customStyles.multiValueLabel(
                ReactSelectProps.styles.multiValueLabel(base),
                state,
              )
            : ReactSelectProps.styles.multiValueLabel(base);
          // With no remove button, the label closes the tag as it opens it.
          return state.selectProps.isDisabled
            ? {
                ...styled,
                paddingRight: styled.paddingLeft ?? base.paddingLeft,
              }
            : styled;
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        valueContainer: (base: any) => ({
          ...base,
          paddingTop: usesLegacyHeight ? 2 : sizeVPadding[resolvedSize],
          paddingBottom: usesLegacyHeight ? 2 : sizeVPadding[resolvedSize],
        }),
      },
    };
  }, [customStyles, resolvedSize, usesLegacyHeight]);

  const labelStyle = useMemo<MultiValueLabelStyle>(
    () => ({
      fontSize: !usesLegacyHeight && resolvedSize === "lg" ? "14px" : "12px",
      fontWeight: 500,
      cursor: sort ? "grab" : undefined,
      title: valueTitles,
    }),
    [resolvedSize, sort, usesLegacyHeight, valueTitles],
  );
  return (
    <OptionCheckedContext.Provider value={isOptionChecked ?? null}>
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
                      size={labelSize ?? "md"}
                      weight={labelWeight}
                    >
                      {label}
                    </Text>
                  ) : (
                    label
                  ))}
                <div style={{ position: "relative" }}>
                  <Component
                    className={clsx(`gb-multi-select--${styleSize}`, {
                      error: !!error && errorLevel === "error",
                      warning: !!error && errorLevel === "warning",
                    })}
                    onPaste={handlePaste}
                    showCopyButton={showCopyButton}
                    extraIndicator={extraIndicator}
                    classNamePrefix="gb-multi-select"
                    helperClass={`multi-select-container gb-multi-select--${styleSize}`}
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
                    inputId={id}
                    aria-label={ariaLabel}
                    ref={ref}
                    formatOptionLabel={formatOptionLabel}
                    formatGroupLabel={formatGroupLabel}
                    isDisabled={disabled || false}
                    options={sorted}
                    isMulti={true}
                    onChange={(selected, meta) => {
                      onChange(
                        selected?.map((s) => s.value) ?? [],
                        meta.action,
                      );
                    }}
                    isValidNewOption={(value) => {
                      if (!pattern) return !!value;
                      return new RegExp(pattern).test(value);
                    }}
                    components={{
                      MultiValue: SortableMultiValue,
                      MultiValueLabel: SortableMultiValueLabel,
                      MultiValueRemove: CustomMultiValueRemove,
                      Option: OptionWithTooltip,
                      Input,
                      ClearIndicator: CustomClearIndicator,
                      GroupHeading,
                      ...(showCopyButton || extraIndicator
                        ? { IndicatorsContainer: IndicatorsContainerWithExtras }
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
                                    <VirtualizedMenuList {...props} />
                                  </>
                                );
                              },
                            }
                          : {
                              DropdownIndicator: CustomDropdownIndicator,
                              IndicatorSeparator: () => null,
                              MenuList: VirtualizedMenuList,
                            }),
                    }}
                    {...(creatable && noMenu
                      ? {
                          // Prevent multi-select from submitting if you type the same value twice
                          onKeyDown: (e) => {
                            const v = (e.target as HTMLInputElement).value;
                            if (
                              e.code === "Enter" &&
                              (!v || value.includes(v))
                            ) {
                              e.preventDefault();
                            }
                          },
                        }
                      : {})}
                    closeMenuOnSelect={closeMenuOnSelect}
                    maxMenuHeight={maxMenuHeight}
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
                    hideSelectedOptions={hideSelectedOptions}
                    filterOption={filterOption}
                    {...(onKeyDown ? { onKeyDown } : {})}
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
    </OptionCheckedContext.Provider>
  );
};

export default MultiSelectField;

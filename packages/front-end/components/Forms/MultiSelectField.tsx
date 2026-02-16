import React, {
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
  MultiValueGenericProps,
  MultiValueProps,
  InputProps,
  StylesConfig,
  OptionProps,
  FormatOptionLabelMeta,
  ClearIndicatorProps,
} from "react-select";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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

const SortableMultiValueContext = createContext<{
  attributes: Record<string, unknown>;
  listeners: Record<string, unknown>;
} | null>(null);

const SortableMultiValue = (props: MultiValueProps<SingleValue>) => {
  const valueArray = props.selectProps.value;
  const index =
    (props as MultiValueProps<SingleValue> & { index?: number }).index ??
    ((Array.isArray(valueArray)
      ? (valueArray as SingleValue[]).findIndex(
          (v) => v?.value === props.data?.value,
        )
      : -1) ||
      0);
  const id = String(index);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  // Hack to stop the dropdown from opening when the user starts dragging
  const onMouseDown: MouseEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const style: React.CSSProperties = {
    transition,
    ...(isDragging
      ? { opacity: 0.5, cursor: "grabbing" }
      : {
          transform: CSS.Transform.toString(transform),
        }),
  };

  const innerProps = {
    ...props.innerProps,
    ref: setNodeRef,
    style: {
      ...(props.innerProps && "style" in props.innerProps
        ? (props.innerProps as { style?: React.CSSProperties }).style
        : {}),
      ...style,
    },
    onMouseDown,
  };

  const contextValue = useMemo(
    () => ({
      attributes: attributes as unknown as Record<string, unknown>,
      listeners: (listeners ?? {}) as unknown as Record<string, unknown>,
    }),
    [attributes, listeners],
  );

  return (
    <SortableMultiValueContext.Provider value={contextValue}>
      {/* @ts-expect-error TS(2322) If you come across this, please fix it!: Type '{ innerProps: { ... } }' - react-select component prop typing */}
      <components.MultiValue {...props} innerProps={innerProps} />
    </SortableMultiValueContext.Provider>
  );
};

const SortableMultiValueLabel = (props: MultiValueGenericProps) => {
  const sortableContext = useContext(SortableMultiValueContext);
  const title = props.data?.tooltip || props.data?.label || "";
  const innerProps = {
    ...props.innerProps,
    title,
    ...(sortableContext && {
      ...sortableContext.attributes,
      ...sortableContext.listeners,
      style: {
        ...props.innerProps.style,
        cursor: "grab",
      },
    }),
  };
  return <components.MultiValueLabel {...props} innerProps={innerProps} />;
};

const OptionWithTitle = (props: OptionProps<SingleValue>) => {
  // @ts-expect-error TS(2322) If you come across this, please fix it!: Type '{ children: ReactNode; innerRef: (instance: ... Remove this comment to see the full error message
  const option = <components.Option {...props} />;
  return <div title={props.data?.tooltip}>{option}</div>;
};

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
  pattern,
  showCopyButton = true,
  ...otherProps
}) => {
  const [map, sorted] = useSelectOptions(options, initialOption, sort);
  const selected = value.map((v) => map.get(v)).filter(isDefined);

  // eslint-disable-next-line
  const fieldProps = otherProps as any;

  const Component = creatable ? CreatableSelect : ReactSelect;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor),
  );

  const sortableIds = useMemo(
    () => selected.map((_, i) => String(i)),
    [selected],
  );

  const handleDragEnd = (event: {
    active: { id: string };
    over: { id: string } | null;
  }) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = parseInt(active.id, 10);
      const newIndex = parseInt(over.id, 10);
      if (!Number.isNaN(oldIndex) && !Number.isNaN(newIndex)) {
        onChange(
          arrayMove(
            selected.map((v) => v.value),
            oldIndex,
            newIndex,
          ),
        );
      }
    }
  };

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

  const mergeStyles = customStyles
    ? {
        styles: {
          ...ReactSelectProps.styles,
          ...customStyles,
        },
      }
    : {};

  const selectProps = {
    onPaste: handlePaste,
    showCopyButton,
    classNamePrefix: "gb-multi-select",
    formatOptionLabel,
    formatGroupLabel,
    isDisabled: disabled || false,
    options: sorted,
    isMulti: true as const,
    onChange: (selectedOptions: SingleValue[] | null) => {
      onChange(selectedOptions?.map((s) => s.value) ?? []);
    },
    isValidNewOption: (val: string) => {
      if (!pattern) return !!val;
      return new RegExp(pattern).test(val);
    },
    components: {
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
              MenuList: (
                props: React.ComponentProps<typeof components.MenuList>,
              ) => (
                <>
                  <div
                    className="px-2 py-1"
                    style={{ fontWeight: 500, fontSize: "85%" }}
                  >
                    <strong>Select an option or create one</strong>
                  </div>
                  <components.MenuList {...props} />
                </>
              ),
            }
          : { IndicatorSeparator: () => null }),
    },
    ...(creatable && noMenu
      ? {
          onKeyDown: (e: React.KeyboardEvent) => {
            const v = (e.target as HTMLInputElement).value;
            if (e.code === "Enter" && (!v || value.includes(v))) {
              e.preventDefault();
            }
          },
        }
      : {}),
    closeMenuOnSelect,
    autoFocus,
    value: selected,
    ...(creatable
      ? {
          formatCreateLabel: (input: string) => (
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
          ),
        }
      : {}),
    placeholder: initialOption ?? placeholder,
    isOptionDisabled,
    ...ReactSelectProps,
    ...mergeStyles,
  };

  return (
    <Field
      {...fieldProps}
      customClassName={clsx(customClassName, { "cursor-disabled": disabled })}
      render={(id, ref) => (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
            <Component {...selectProps} id={id} ref={ref} />
          </SortableContext>
        </DndContext>
      )}
    />
  );
};

export default MultiSelectField;

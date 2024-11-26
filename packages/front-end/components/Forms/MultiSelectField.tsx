import { FC, MouseEventHandler, ReactNode } from "react";
import ReactSelect, {
  components,
  MultiValueGenericProps,
  MultiValueProps,
  InputProps,
  Props,
  StylesConfig,
  OptionProps,
  FormatOptionLabelMeta,
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
import {
  ReactSelectProps,
  SingleValue,
  Option,
  useSelectOptions,
} from "@/components/Forms/SelectField";
import Field, { FieldProps } from "@/components/Forms/Field";

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
  }
);

// eslint-disable-next-line
const SortableMultiValueLabel = SortableHandle<any>(
  (props: MultiValueGenericProps) => {
    const label = <components.MultiValueLabel {...props} />;
    if (props.data?.tooltip) {
      return <div title={props.data.tooltip}>{label}</div>;
    }
    return label;
  }
);

const OptionWithTitle = (props: OptionProps<SingleValue>) => {
  // @ts-expect-error TS(2322) If you come across this, please fix it!: Type '{ children: ReactNode; innerRef: (instance: ... Remove this comment to see the full error message
  const option = <components.Option {...props} />;
  if (props.data?.tooltip) {
    return <div title={props.data.tooltip}>{option}</div>;
  }
  return option;
};

const SortableSelect = SortableContainer(ReactSelect) as React.ComponentClass<
  Props<SingleValue, true> & SortableContainerProps
>;

const SortableCreatableSelect = SortableContainer(
  CreatableSelect
) as React.ComponentClass<Props<SingleValue, true> & SortableContainerProps>;

const Input = (props: InputProps) => {
  // @ts-expect-error will be passed down
  const { onPaste } = props.selectProps;
  return <components.Input onPaste={onPaste} {...props} />;
};

export type MultiSelectFieldProps = Omit<
  FieldProps,
  "value" | "onChange" | "options" | "multi" | "initialOption" | "placeholder"
> & {
  value: string[];
  placeholder?: string;
  options: Option[];
  initialOption?: string;
  onChange: (value: string[]) => void;
  sort?: boolean;
  customStyles?: StylesConfig;
  customClassName?: string;
  closeMenuOnSelect?: boolean;
  creatable?: boolean;
  formatOptionLabel?: (
    value: SingleValue,
    meta: FormatOptionLabelMeta<SingleValue>
  ) => ReactNode;
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  isOptionDisabled?: (_: Option) => boolean;
  noMenu?: boolean;
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
  onPaste,
  isOptionDisabled,
  noMenu,
  ...otherProps
}) => {
  const [map, sorted] = useSelectOptions(options, initialOption, sort);
  const selected = value.map((v) => map.get(v)).filter(isDefined);

  // eslint-disable-next-line
  const fieldProps = otherProps as any;

  const Component = creatable ? SortableCreatableSelect : SortableSelect;

  const onSortEnd: SortEndHandler = ({ oldIndex, newIndex }) => {
    onChange(
      arrayMove(
        selected.map((v) => v.value),
        oldIndex,
        newIndex
      )
    );
  };
  const mergeStyles = customStyles ? { styles: customStyles } : {};
  return (
    <Field
      {...fieldProps}
      customClassName={clsx(customClassName, { "cursor-disabled": disabled })}
      render={(id, ref) => {
        return (
          <Component
            onPaste={onPaste}
            useDragHandle
            classNamePrefix="gb-multi-select"
            helperClass="multi-select-container"
            axis="xy"
            onSortEnd={onSortEnd}
            distance={4}
            getHelperDimensions={({ node }) => node.getBoundingClientRect()}
            id={id}
            ref={ref}
            formatOptionLabel={formatOptionLabel}
            isDisabled={disabled || false}
            options={sorted}
            isMulti={true}
            onChange={(selected) => {
              onChange(selected?.map((s) => s.value) ?? []);
            }}
            components={{
              // eslint-disable-next-line
              // @ts-expect-error We're failing to provide a required index prop to SortableElement
              MultiValue: SortableMultiValue,
              MultiValueLabel: SortableMultiValueLabel,
              Option: OptionWithTitle,
              Input,
              ...(creatable && noMenu
                ? {
                    Menu: () => null,
                    DropdownIndicator: () => null,
                    IndicatorSeparator: () => null,
                  }
                : creatable
                ? {
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
                : {}),
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
        );
      }}
    />
  );
};

export default MultiSelectField;

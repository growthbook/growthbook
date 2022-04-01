import { FC, MouseEventHandler } from "react";
import Field, { FieldProps } from "./Field";
import ReactSelect, {
  components,
  MultiValueGenericProps,
  MultiValueProps,
  Props,
} from "react-select";
import {
  SortableContainer,
  SortableContainerProps,
  SortableElement,
  SortEndHandler,
  SortableHandle,
} from "react-sortable-hoc";
import {
  SingleValue,
  GroupedValue,
  useSelectOptions,
  ReactSelectProps,
} from "./SelectField";
import { arrayMove } from "@dnd-kit/sortable";

const SortableMultiValue = SortableElement(
  (props: MultiValueProps<SingleValue>) => {
    // Hack to stop the dropdown from opening when the user starts dragging
    const onMouseDown: MouseEventHandler<HTMLDivElement> = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const innerProps = { ...props.innerProps, onMouseDown };
    return <components.MultiValue {...props} innerProps={innerProps} />;
  }
);

const SortableMultiValueLabel = SortableHandle(
  (props: MultiValueGenericProps) => <components.MultiValueLabel {...props} />
);

const SortableSelect = SortableContainer(ReactSelect) as React.ComponentClass<
  Props<SingleValue, true> & SortableContainerProps
>;

const MultiSelectField: FC<
  Omit<
    FieldProps,
    "value" | "onChange" | "options" | "multi" | "initialOption" | "placeholder"
  > & {
    value: string[];
    placeholder?: string;
    options: (SingleValue | GroupedValue)[];
    initialOption?: string;
    onChange: (value: string[]) => void;
    sort?: boolean;
  }
> = ({
  value,
  options,
  onChange,
  initialOption,
  placeholder = "Select...",
  sort = true,
  disabled,
  autoFocus,
  ...otherProps
}) => {
  const [map, sorted] = useSelectOptions(options, initialOption, sort);
  const selected = value.map((v) => map.get(v)).filter(Boolean);

  // eslint-disable-next-line
  const fieldProps = otherProps as any;

  const onSortEnd: SortEndHandler = ({ oldIndex, newIndex }) => {
    onChange(
      arrayMove(
        selected.map((v) => v.value),
        oldIndex,
        newIndex
      )
    );
  };

  return (
    <Field
      {...fieldProps}
      render={(id, ref) => {
        return (
          <SortableSelect
            useDragHandle
            helperClass="multi-select-container"
            axis="xy"
            onSortEnd={onSortEnd}
            distance={4}
            getHelperDimensions={({ node }) => node.getBoundingClientRect()}
            id={id}
            ref={ref}
            isDisabled={disabled || false}
            options={sorted}
            isMulti={true}
            onChange={(selected) => {
              onChange(selected?.map((s) => s.value) ?? []);
            }}
            components={{
              // eslint-disable-next-line
              // @ts-ignore We're failing to provide a required index prop to SortableElement
              MultiValue: SortableMultiValue,
              MultiValueLabel: SortableMultiValueLabel,
            }}
            closeMenuOnSelect={false}
            autoFocus={autoFocus}
            value={selected}
            placeholder={initialOption ?? placeholder}
            {...ReactSelectProps}
          />
        );
      }}
    />
  );
};

export default MultiSelectField;

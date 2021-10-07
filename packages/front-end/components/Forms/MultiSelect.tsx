import { FC, useMemo } from "react";
import { Typeahead } from "react-bootstrap-typeahead";
import Field, { FieldProps } from "./Field";

const MultiSelect: FC<
  Omit<FieldProps, "value" | "onChange" | "options"> & {
    value: string[];
    options: { display: string; value: string }[];
    onChange: (value: string[]) => void;
  }
> = ({ value, options, onChange, ...otherProps }) => {
  const map = useMemo(() => {
    const m = new Map<string, { display: string; value: string }>();
    options.forEach((o) => {
      m.set(o.value, o);
    });
    return m;
  }, [options]);
  const selected = value.map((v) => map.get(v));

  // eslint-disable-next-line
  const fieldProps = otherProps as any;

  return (
    <Field
      {...fieldProps}
      render={(id, ref) => {
        return (
          <Typeahead
            id={id}
            labelKey="display"
            ref={ref}
            multiple={true}
            options={options}
            onChange={(selected) => {
              onChange(selected.map((s) => s.value));
            }}
            selected={selected}
            placeholder="Select..."
          />
        );
      }}
    />
  );
};

export default MultiSelect;

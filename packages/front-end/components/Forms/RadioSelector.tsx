import clsx from "clsx";
import { FC } from "react";
import { UseFormReturn } from "react-hook-form";
import { FaInfoCircle } from "react-icons/fa";

const RadioSelector: FC<{
  name: string;
  options: {
    key: string;
    display?: string;
    description: string;
    sub?: string;
    tooltip?: string;
    enabled?: boolean;
  }[];
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  labelWidth?: number;
}> = ({ name, options, form, labelWidth = 100 }) => {
  const value = form.watch(name);

  return (
    <div>
      {options.map(({ key, display, description, sub, tooltip, enabled }) => (
        <div
          className={clsx("list-group", { "d-none": enabled === false })}
          key={key}
        >
          <label
            className="list-group-item list-group-item-action m-0"
            style={
              value === key
                ? {
                    backgroundColor: "lightblue",
                  }
                : null
            }
          >
            <div className="d-flex w-100">
              <input
                type="radio"
                name={name}
                value={key}
                className="m-1"
                {...form.register(name)}
              />
              <strong style={{ width: labelWidth, paddingRight: 5 }}>
                {display || key}
              </strong>
              <div style={{ flex: 1 }}>
                {description}
                {sub && (
                  <div>
                    <small>{sub}</small>
                  </div>
                )}
              </div>
              {tooltip && (
                <FaInfoCircle title={tooltip} className="d-none d-lg-block" />
              )}
            </div>
          </label>
        </div>
      ))}
    </div>
  );
};
export default RadioSelector;

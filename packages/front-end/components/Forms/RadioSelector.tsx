import clsx from "clsx";
import { FC, ReactElement } from "react";
import { FaInfoCircle } from "react-icons/fa";

const RadioSelector: FC<{
  name: string;
  options: {
    key: string;
    display?: string | ReactElement;
    description: string | ReactElement;
    sub?: string;
    tooltip?: string;
    hidden?: boolean;
    disabled?: boolean;
  }[];
  value: string;
  labelWidth?: number | string;
  descriptionNewLine?: boolean;
  setValue: (value: string) => void;
}> = ({
  name,
  options,
  value,
  labelWidth = 70,
  setValue,
  descriptionNewLine = false,
}) => {
  const renderLabelData = ({ key, display, description, sub, tooltip }) => (
    <>
      {typeof display === "string" ? (
        <strong style={{ width: labelWidth, paddingRight: 5 }}>
          {display || key}
        </strong>
      ) : (
        display
      )}
      {typeof description === "string" ? (
        <div style={{ flex: 1 }}>
          {description}
          {sub && (
            <div>
              <small>{sub}</small>
            </div>
          )}
        </div>
      ) : (
        description
      )}
      {tooltip && (
        <FaInfoCircle title={tooltip} className="d-none d-lg-block" />
      )}
    </>
  );

  return (
    <div>
      {options.map(
        ({ key, display, description, sub, tooltip, disabled, hidden }) => (
          <div
            className={clsx("list-group", { "d-none": hidden === true })}
            key={key}
          >
            <label className="list-group-item list-group-item-action border-0 m-0 px-1 py-2">
              <div className="d-flex w-100">
                <input
                  type="radio"
                  name={name}
                  value={key}
                  disabled={disabled}
                  className="m-1 mr-2 h-100"
                  checked={value === key}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setValue(key);
                    }
                  }}
                />
                {descriptionNewLine ? (
                  <div>
                    {renderLabelData({
                      key,
                      display,
                      description,
                      sub,
                      tooltip,
                    })}
                  </div>
                ) : (
                  renderLabelData({ key, display, description, sub, tooltip })
                )}
              </div>
            </label>
          </div>
        ),
      )}
    </div>
  );
};
export default RadioSelector;

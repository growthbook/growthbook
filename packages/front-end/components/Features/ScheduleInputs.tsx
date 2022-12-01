import { ScheduleRule } from "back-end/types/feature";
import React, { useEffect, useState } from "react";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import { GBAddCircle } from "../Icons";

interface Props {
  defaultValue: ScheduleRule[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (value: ScheduleRule[]) => void;
}

const getLocalDateTime = (rawDateTime: string) => {
  if (!rawDateTime) {
    return "";
  }
  const utcDateTime = new Date(rawDateTime);

  // We need to adjust for timezone/daylight savings time before converting to ISO String to pass into datetime-local field
  utcDateTime.setHours(
    utcDateTime.getHours() - new Date(rawDateTime).getTimezoneOffset() / 60
  );
  return utcDateTime.toISOString().substring(0, 16);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function ScheduleInputs(props: Props) {
  const [rules, setRules] = useState(props.defaultValue);
  const [dateErrors, setDateErrors] = useState({});
  const [ruleErrors, setRuleErrors] = useState({});

  useEffect(() => {
    props.onChange(rules);
  }, [props, props.defaultValue, rules]);

  const options = [
    { label: "enabled", value: "true" },
    { label: "disabled", value: "false" },
  ];

  if (!rules.length) {
    return (
      <div>
        <label className="mb-0">Schedule</label>
        <div className="m-2">
          <em className="text-muted mr-3">
            Enable and disable override rules at specific dates and times.
          </em>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setRules([
                {
                  enableFeature: true,
                  timestamp: new Date().toISOString(),
                },
              ]);
            }}
          >
            Add schedule rule
          </a>
        </div>
      </div>
    );
  }

  return (
    <>
      <label className="mb-0">Schedule</label>
      <div className="bg-light p-3 border mt-2 mb-2">
        {rules.map(({ timestamp, enableFeature }, i) => {
          const onChange = (value, property, i) => {
            const newRules = [...rules];
            if (property === "enableFeature") {
              newRules[i][property] = value === "true" ? true : false;
            } else {
              newRules[i][property] = value;
            }
            setRules(newRules);
          };

          return (
            <div className="d-flex align-items-center" key={i}>
              <div className="mb-2">
                <span className="mb-2">Change rule status to</span>
              </div>
              <div className="col-sm-12 col-md mb-2">
                <SelectField
                  name="enableFeature"
                  value={enableFeature.toString()}
                  options={options}
                  onFocus={() => setRuleErrors({ [i]: "" })}
                  onChange={(value) => {
                    setRuleErrors({
                      [i]: "",
                    });
                    if (
                      i > 0 &&
                      value === rules[i - 1].enableFeature.toString()
                    ) {
                      setRuleErrors({
                        [i]: "Status can't be equal to previous rule.",
                      });
                      return;
                    }
                    onChange(value, "enableFeature", i);
                  }}
                  error={ruleErrors[i]}
                />
              </div>
              <span className="mb-2">on</span>
              <div className="col-sm-12 col-md mb-2">
                <Field
                  type="datetime-local"
                  value={getLocalDateTime(timestamp)}
                  onChange={(e) => {
                    setDateErrors({ [i]: "" });
                    if (
                      i > 0 &&
                      new Date(e.target.value).valueOf() <
                        new Date(rules[i - 1].timestamp).valueOf()
                    ) {
                      setDateErrors({
                        [i]:
                          "Date must be greater than the previous rule date.",
                      });
                      return;
                    }
                    onChange(e.target.value, "timestamp", i);
                  }}
                  name="timestamp"
                  error={dateErrors[i] || ""}
                />
              </div>
              {getLocalDateTime(timestamp) && (
                <span
                  className="font-italic font-weight-light mb-2"
                  style={{ fontSize: "12px" }}
                >
                  (
                  {new Date(getLocalDateTime(timestamp))
                    .toLocaleDateString(undefined, {
                      day: "2-digit",
                      timeZoneName: "short",
                    })
                    .substring(4)}
                  )
                </span>
              )}
              <div className="col-sm-12 col-md mb-2">
                <button
                  className="btn btn-link text-danger"
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setRuleErrors({
                      [i]: "",
                    });
                    setDateErrors({
                      [i]: "",
                    });
                    const newRules = [...rules];
                    newRules.splice(i, 1);
                    setRules(newRules);
                  }}
                >
                  {" "}
                  remove
                </button>
              </div>
            </div>
          );
        })}
        <div>
          <a
            className={`mr-3 btn btn-outline-primary mt-3`}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setRules([
                ...rules,
                {
                  timestamp: new Date().toISOString(),
                  enableFeature: !rules[rules.length - 1].enableFeature,
                },
              ]);
            }}
          >
            <span className={`h4 pr-2 m-0 d-inline-block align-top`}>
              <GBAddCircle />
            </span>
            Add another schedule rule
          </a>
        </div>
      </div>
    </>
  );
}

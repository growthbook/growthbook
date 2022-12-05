import { ScheduleRule } from "back-end/types/feature";
import clsx from "clsx";
import React, { useEffect, useState } from "react";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import styles from "./ScheduleInputs.module.scss";

interface Props {
  defaultValue: ScheduleRule[];
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

export default function ScheduleInputs(props: Props) {
  const [rules, setRules] = useState(props.defaultValue);
  const [dateErrors, setDateErrors] = useState({});

  useEffect(() => {
    props.onChange(rules);
  }, [props, props.defaultValue, rules]);

  const launchOptions = [
    { label: "immediately", value: "immediately" },
    {
      label: "at a specific date and time",
      value: "at a specific date and time",
    },
  ];

  const endOptions = [
    { label: "manually", value: "manually" },
    {
      label: "at a specific date and time",
      value: "at a specific date and time",
    },
  ];

  if (!rules.length) {
    return (
      <div>
        <label className="mb-0">Schedule</label>
        <div className="m-2">
          <em className="text-muted mr-3">
            Automatically enable and disable an override rule.
          </em>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setRules([
                {
                  enableFeature: true,
                  timestamp: null,
                },
                {
                  enableFeature: false,
                  timestamp: null,
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
    <div className="form-group">
      <label>Schedule</label>
      <div className={`mb-3 bg-light pt-3 pr-3 pl-3 ${styles.conditionbox}`}>
        <span className="text-muted mr-3 mt-3">
          Automatically enable and disable an override rule.
        </span>
        <ul className={styles.conditionslist}>
          {rules.map(({ timestamp, enableFeature }, i) => {
            const onChange = (value, property, i) => {
              const newRules = [...rules];
              newRules[i][property] = value;
              setRules(newRules);
            };

            return (
              <li key={i} className={styles.listitem}>
                <div className="row align-items-center">
                  <span className="ml-2 mb-2">
                    {(i + 1) % 2 === 1 ? "Launch rule" : "Disable Rule"}
                  </span>
                  <div className="col-sm-12 col-md mb-2 pl-2 pr-2">
                    <SelectField
                      name="date-operator"
                      value={
                        timestamp !== null
                          ? "at a specific date and time"
                          : enableFeature
                          ? "immediately"
                          : "manually"
                      }
                      options={(i + 1) % 2 === 1 ? launchOptions : endOptions}
                      onChange={(value) => {
                        if (value === "at a specific date and time") {
                          onChange(new Date().toISOString(), "timestamp", i);
                        } else {
                          onChange(null, "timestamp", i);
                        }
                      }}
                    />
                  </div>
                  {timestamp !== null && (
                    <>
                      <div className="w-auto mb-2 p-2">
                        <span className="mb-2">ON</span>
                      </div>
                      <div className="col-sm-12 col-md mb-2 d-flex align-items-center">
                        <Field
                          type="datetime-local"
                          className={clsx(dateErrors[i] && styles.error)}
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
                        />
                        {getLocalDateTime(timestamp) && (
                          <span
                            className="font-italic font-weight-light ml-2"
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
                      </div>
                      {dateErrors[i] && (
                        <div className="ml-2 alert alert-danger mb-0">
                          {dateErrors[i]}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

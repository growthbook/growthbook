import { ScheduleRule } from "back-end/types/feature";
import clsx from "clsx";
import { format } from "date-fns";
import { format as formatTimeZone } from "date-fns-tz";
import React, { useEffect, useState } from "react";
import { useUser } from "@/services/UserContext";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Checkbox from "@/components/Radix/Checkbox";
import styles from "./ScheduleInputs.module.scss";

interface Props {
  defaultValue: ScheduleRule[];
  onChange: (value: ScheduleRule[]) => void;
  scheduleToggleEnabled: boolean;
  setScheduleToggleEnabled: (value: boolean) => void;
}

export default function ScheduleInputs(props: Props) {
  const [rules, setRules] = useState(props.defaultValue);
  const [dateErrors, setDateErrors] = useState("");
  const { hasCommercialFeature } = useUser();

  const canScheduleFeatureFlags = hasCommercialFeature("schedule-feature-flag");

  useEffect(() => {
    props.onChange(rules);
  }, [props, props.defaultValue, rules]);

  function dateIsValid(date: Date) {
    return date instanceof Date && !isNaN(date.valueOf());
  }

  const onChange = (value: string | null, property: string, i: number) => {
    if (value && !dateIsValid(new Date(value))) {
      return;
    }
    const newRules = [...rules];
    newRules[i][property] = value;
    setRules(newRules);
  };

  return (
    <div className="my-3">
      <Checkbox
        size="lg"
        label={
          <PremiumTooltip commercialFeature="schedule-feature-flag">
            Apply Schedule
          </PremiumTooltip>
        }
        description="Enable/disable rule based on selected date and time"
        value={props.scheduleToggleEnabled}
        setValue={(v) => {
          props.setScheduleToggleEnabled(v === true);

          if (!rules.length) {
            setRules([
              {
                enabled: true,
                timestamp: null,
              },
              {
                enabled: false,
                timestamp: null,
              },
            ]);
          }
        }}
        disabled={!canScheduleFeatureFlags}
      />
      {rules.length > 0 && props.scheduleToggleEnabled && (
        <div className={`box mb-3 bg-light pt-2 px-3 ${styles.conditionbox}`}>
          <ul className={styles.conditionslist}>
            <li className={styles.listitem}>
              <div className="row align-items-center">
                <span className="ml-2 mb-2">Launch rule</span>
                <div className="col-sm-12 col-md mb-2 pl-2 pr-2">
                  <SelectField
                    name="date-operator"
                    value={rules[0].timestamp === null ? "" : "timestamp"}
                    options={[
                      { label: "immediately", value: "" },
                      {
                        label: "at a specific date and time",
                        value: "timestamp",
                      },
                    ]}
                    onChange={(value) => {
                      if (value) {
                        onChange(
                          format(new Date(), "yyyy-MM-dd'T'HH:mm"),
                          "timestamp",
                          0
                        );
                      } else {
                        onChange(null, "timestamp", 0);
                      }
                    }}
                  />
                </div>
                {rules[0].timestamp !== null && (
                  <>
                    <div className="w-auto mb-2 p-2">
                      <span className="mb-2">ON</span>
                    </div>
                    <div className="col-sm-12 col-md mb-2 d-flex align-items-center">
                      <Field
                        type="datetime-local"
                        value={format(
                          new Date(rules[0].timestamp),
                          "yyyy-MM-dd'T'HH:mm"
                        )}
                        onChange={(e) => {
                          onChange(e.target.value, "timestamp", 0);
                        }}
                        name="timestamp"
                      />
                      <span className="pl-2">
                        ({formatTimeZone(new Date(), "z")})
                      </span>
                    </div>
                  </>
                )}
              </div>
            </li>
            <li className={styles.listitem}>
              <div className="row align-items-center">
                <span className="ml-2 mb-2">Disable rule </span>
                <div className="col-sm-12 col-md mb-2 pl-2 pr-2">
                  <SelectField
                    name="date-operator"
                    value={rules[1].timestamp === null ? "" : "timestamp"}
                    options={[
                      { label: "manually", value: "" },
                      {
                        label: "at a specific date and time",
                        value: "timestamp",
                      },
                    ]}
                    onChange={(value) => {
                      if (value) {
                        onChange(
                          format(new Date(), "yyyy-MM-dd'T'HH:mm"),
                          "timestamp",
                          1
                        );
                      } else {
                        onChange(null, "timestamp", 1);
                      }
                    }}
                  />
                </div>
                {rules[1].timestamp !== null && (
                  <>
                    <div className="w-auto mb-2 p-2">
                      <span className="mb-2">ON</span>
                    </div>
                    <div className="col-sm-12 col-md mb-2 d-flex align-items-center">
                      <Field
                        type="datetime-local"
                        className={clsx(dateErrors && styles.error)}
                        value={format(
                          new Date(rules[1].timestamp),
                          "yyyy-MM-dd'T'HH:mm"
                        )}
                        onChange={(e) => {
                          setDateErrors("");
                          if (
                            rules[0].timestamp &&
                            new Date(e.target.value) <
                              new Date(rules[0].timestamp)
                          ) {
                            setDateErrors(
                              "End date must be greater than the previous rule date."
                            );
                            return;
                          }
                          onChange(e.target.value, "timestamp", 1);
                        }}
                        name="timestamp"
                      />
                      <span className="pl-2">
                        ({formatTimeZone(new Date(), "z")})
                      </span>
                    </div>
                    {dateErrors && (
                      <div className="ml-2 alert alert-danger mb-0">
                        {dateErrors}
                      </div>
                    )}
                  </>
                )}
              </div>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

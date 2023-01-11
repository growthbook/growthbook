import { ScheduleRule } from "back-end/types/feature";
import clsx from "clsx";
import { format } from "date-fns";
import { format as formatTimeZone } from "date-fns-tz";
import React, { useEffect, useState } from "react";
import { useUser } from "@/services/UserContext";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import Toggle from "../Forms/Toggle";
import UpgradeLabel from "../Marketing/UpgradeLabel";
import styles from "./ScheduleInputs.module.scss";

interface Props {
  defaultValue: ScheduleRule[];
  onChange: (value: ScheduleRule[]) => void;
  setShowUpgradeModal: (value: boolean) => void;
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

  const onChange = (value: string, property: string, i: number) => {
    if (!dateIsValid(new Date(value))) {
      return;
    }
    const newRules = [...rules];
    newRules[i][property] = value;
    setRules(newRules);
  };

  return (
    <div className="form-group">
      <UpgradeLabel
        showUpgradeModal={() => props.setShowUpgradeModal(true)}
        commercialFeature="schedule-feature-flag"
        upgradeMessage="enable feature flag scheduling"
        labelText="Add scheduling to automatically enable/disable an override rule."
      />
      <div className="pb-2">
        <Toggle
          id="schedule-toggle"
          value={props.scheduleToggleEnabled}
          setValue={(v) => {
            props.setScheduleToggleEnabled(v);

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
          type="featureValue"
        />
        <span className="text-muted pl-2">
          <strong>{props.scheduleToggleEnabled ? "on" : "off"}</strong>
        </span>
      </div>
      {rules.length > 0 && props.scheduleToggleEnabled && (
        <div className={`mb-3 bg-light pt-3 pr-3 pl-3 ${styles.conditionbox}`}>
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

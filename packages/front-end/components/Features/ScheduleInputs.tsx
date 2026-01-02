import { ScheduleRule } from "shared/types/feature";
import { format as formatTimeZone } from "date-fns-tz";
import React, { useEffect, useState } from "react";
import { getValidDate } from "shared/dates";
import { useUser } from "@/services/UserContext";
import SelectField from "@/components/Forms/SelectField";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Checkbox from "@/ui/Checkbox";
import DatePicker from "@/components/DatePicker";
import Callout from "@/ui/Callout";

interface Props {
  defaultValue: ScheduleRule[];
  onChange: (value: ScheduleRule[]) => void;
  scheduleToggleEnabled: boolean;
  setScheduleToggleEnabled: (value: boolean) => void;
  disabled?: boolean;
}

export default function ScheduleInputs(props: Props) {
  const [rules, setRules] = useState(props.defaultValue);
  const { hasCommercialFeature } = useUser();

  const canScheduleFeatureFlags = hasCommercialFeature("schedule-feature-flag");

  useEffect(() => {
    props.onChange(rules);
  }, [props, props.defaultValue, rules]);

  const [date0, setDate0] = useState<Date | undefined>(
    rules?.[0]?.timestamp ? getValidDate(rules[0].timestamp) : undefined,
  );
  const [date1, setDate1] = useState<Date | undefined>(
    rules?.[1]?.timestamp ? getValidDate(rules[1].timestamp) : undefined,
  );

  function dateIsValid(date: Date) {
    return date instanceof Date && !isNaN(date.valueOf());
  }

  const onChange = (value: Date | undefined, property: string, i: number) => {
    if (i === 0) setDate0(value);
    if (i === 1) setDate1(value);
    if (value && !dateIsValid(value)) return;

    const newRules = [...rules];
    newRules[i][property] = value ?? null;
    setRules(newRules);
  };

  const dateError = date0 && date1 && date0 > date1;

  return (
    <div className="my-3">
      <Checkbox
        size="lg"
        label={
          <PremiumTooltip commercialFeature="schedule-feature-flag">
            Apply Schedule
          </PremiumTooltip>
        }
        description="Schedule this rule to be automatically enabled or disabled in the future"
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
        disabled={!canScheduleFeatureFlags || props.disabled}
      />
      {rules.length > 0 && props.scheduleToggleEnabled && (
        <div className="box mb-3 bg-light pt-2 px-3">
          <div className="row align-items-center py-2">
            <div className="ml-2 mb-2" style={{ width: 100 }}>
              Launch rule
            </div>
            <div className="col-sm-12 col-md mb-2 pl-2 pr-2">
              <SelectField
                style={{ width: 250 }}
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
                    onChange(new Date(), "timestamp", 0);
                  } else {
                    onChange(undefined, "timestamp", 0);
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
                  <DatePicker
                    date={date0}
                    setDate={(d) => {
                      onChange(d, "timestamp", 0);
                    }}
                    disableBefore={new Date()}
                    scheduleEndDate={
                      rules[1].timestamp
                        ? getValidDate(rules[1].timestamp)
                        : undefined
                    }
                    containerClassName=""
                  />
                  <span className="pl-2">
                    ({formatTimeZone(new Date(), "z")})
                  </span>
                </div>
              </>
            )}
          </div>
          <div className="row align-items-center py-2">
            <div className="ml-2 mb-2" style={{ width: 100 }}>
              Disable rule
            </div>
            <div className="col-sm-12 col-md mb-2 pl-2 pr-2">
              <SelectField
                style={{ width: 250 }}
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
                    onChange(new Date(), "timestamp", 1);
                  } else {
                    onChange(undefined, "timestamp", 1);
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
                  <DatePicker
                    date={date1}
                    setDate={(d) => {
                      if (
                        rules[0].timestamp &&
                        getValidDate(d) < getValidDate(rules[0].timestamp)
                      ) {
                        return;
                      }
                      onChange(d, "timestamp", 1);
                    }}
                    disableBefore={
                      rules[0].timestamp
                        ? getValidDate(rules[0].timestamp)
                        : new Date()
                    }
                    scheduleStartDate={
                      rules[0].timestamp
                        ? getValidDate(rules[0].timestamp)
                        : undefined
                    }
                    containerClassName=""
                  />
                  <span className="pl-2">
                    ({formatTimeZone(new Date(), "z")})
                  </span>
                </div>
              </>
            )}
          </div>
          {dateError && (
            <Callout status="error" mb="4">
              End date must be greater than the previous rule date
            </Callout>
          )}
        </div>
      )}
    </div>
  );
}

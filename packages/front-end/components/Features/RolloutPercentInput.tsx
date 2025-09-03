import { Slider } from "@radix-ui/themes";
import React from "react";
import styles from "@/components/Features/VariationsInput.module.scss";
import Field from "@/components/Forms/Field";
import { decimalToPercent, percentToDecimal } from "@/services/utils";

export interface Props {
  value: number;
  setValue: (value: number) => void;
  label?: string;
  className?: string;
}

export default function RolloutPercentInput({
  value,
  setValue,
  label = "Percent of Units",
  className,
}: Props) {
  return (
    <div className={`form-group ${className}`}>
      <label>{label}</label>
      <div className="row align-items-center">
        <div className="col">
          <Slider
            value={[value]}
            min={0}
            max={1}
            step={0.01}
            onValueChange={(e) => {
              setValue(e[0]);
            }}
          />
        </div>
        <div className="col-auto">
          <div className={`position-relative ${styles.percentInputWrap}`}>
            <Field
              style={{ width: 95 }}
              value={isNaN(value ?? 0) ? "" : decimalToPercent(value ?? 0)}
              step={1}
              onChange={(e) => {
                let decimal = percentToDecimal(e.target.value);
                if (decimal > 1) decimal = 1;
                if (decimal < 0) decimal = 0;
                setValue(decimal);
              }}
              type="number"
            />
            <span>%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

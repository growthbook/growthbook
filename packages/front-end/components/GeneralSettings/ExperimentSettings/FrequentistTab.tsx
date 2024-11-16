import { DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER } from "shared/constants";
import { FaExclamationTriangle } from "react-icons/fa";
import { PValueCorrection } from "back-end/types/stats";
import Field from "@/components/Forms/Field";
import Toggle from "@/components/Forms/Toggle";
import SelectField from "@/components/Forms/SelectField";
import { GBSequential } from "@/components/Icons";
import { hasFileConfig } from "@/services/env";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { StatsEngineSettingsForm } from "./StatsEngineSettings";

export default function FrequentistTab({
  pHighlightColor,
  pWarningMsg,
  form,
}: {
  pHighlightColor: string;
  pWarningMsg: string;
  form: StatsEngineSettingsForm;
}) {
  const { hasCommercialFeature } = useUser();

  return (
    <>
      <h4 className="mb-4 text-purple">频率学派设置</h4>

      <div className="form-group mb-2 mr-2 form-inline">
        <Field
          label="P值阈值"
          type="number"
          step="0.001"
          max="0.5"
          min="0.001"
          style={{
            borderColor: pHighlightColor,
            backgroundColor: pHighlightColor ? pHighlightColor + "15" : "",
          }}
          className={`ml-2`}
          containerClassName="mb-3"
          append=""
          disabled={hasFileConfig()}
          helpText={
            <>
              <span className="ml-2">(默认值为0.05)</span>
              <div
                className="ml-2"
                style={{
                  color: pHighlightColor,
                  flexBasis: "100%",
                }}
              >
                {pWarningMsg}
              </div>
            </>
          }
          {...form.register("pValueThreshold", {
            valueAsNumber: true,
            min: 0,
            max: 1,
          })}
        />
      </div>
      <div className="mb-3  form-inline flex-column align-items-start">
        <SelectField
          label="要使用的多重比较校正："
          className="ml-2"
          value={form.watch("pValueCorrection") ?? ""}
          onChange={(value) =>
            form.setValue("pValueCorrection", value as PValueCorrection)
          }
          sort={false}
          options={[
            {
              label: "无",
              value: "",
            },
            {
              label: "霍尔姆 - 邦费罗尼（控制FWER）",
              value: "holm-bonferroni",
            },
            {
              label: "本雅明尼 - 霍赫贝格（控制FDR）",
              value: "benjamini-hochberg",
            },
          ]}
        />
      </div>

      {/* <div className="p-3 my-3 border rounded">
        <h5 className="font-weight-bold mb-4">
          <PremiumTooltip commercialFeature="sequential-testing">
            <GBSequential /> 顺序检验
          </PremiumTooltip>
        </h5>
        <div className="form-group mb-0 mr-2">
          <div className="d-flex">
            <label className="mr-1" htmlFor="toggle-sequentialTestingEnabled">
              默认应用顺序检验
            </label>
            <Toggle
              id={"toggle-sequentialTestingEnabled"}
              value={form.watch("sequentialTestingEnabled")}
              setValue={(value) => {
                form.setValue("sequentialTestingEnabled", value);
              }}
              disabled={
                !hasCommercialFeature("sequential-testing") || hasFileConfig()
              }
            />
          </div>
          {form.watch("sequentialTestingEnabled") &&
            form.watch("statsEngine") === "bayesian" && (
              <div className="d-flex">
                <small className="mb-1 text-warning-orange">
                  <FaExclamationTriangle /> 您的组织默认使用贝叶斯统计，且贝叶斯引擎未实现顺序检验。
                </small>
              </div>
            )}
        </div>
        <div
          className="form-group mt-3 mb-0 mr-2 form-inline"
          style={{
            opacity: form.watch("sequentialTestingEnabled") ? "1" : "0.5",
          }}
        >
          <Field
            label="调优参数"
            type="number"
            className={`ml-2`}
            containerClassName="mb-0"
            min="0"
            disabled={
              !hasCommercialFeature("sequential-testing") || hasFileConfig()
            }
            helpText={
              <>
                <span className="ml-2">
                  （{DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER}为默认值）
                </span>
              </>
            }
            {...form.register("sequentialTestingTuningParameter", {
              valueAsNumber: true,
              validate: (v) => {
                return !(v <= 0);
              },
            })}
          />
        </div>
      </div> */}
    </>
  );
}
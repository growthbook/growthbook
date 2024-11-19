import { FC } from "react";
import {
  ExperimentInterfaceStringDates,
  ExperimentResultsType,
} from "back-end/types/experiment";
import { useForm } from "react-hook-form";
import { experimentHasLinkedChanges } from "shared/util";
import { FaExclamationTriangle } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import SelectField from "@/components/Forms/SelectField";
import Modal from "@/components/Modal";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import Field from "@/components/Forms/Field";
import Toggle from "@/components/Forms/Toggle";
import { DocLink } from "@/components/DocLink";

const StopExperimentForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  close: () => void;
  source?: string;
}> = ({ experiment, close, mutate, source }) => {
  const isBandit = experiment.type == "multi-armed-bandit";
  const isStopped = experiment.status === "stopped";

  const hasLinkedChanges = experimentHasLinkedChanges(experiment);

  const phases = experiment.phases || [];
  const lastPhaseIndex = phases.length - 1;
  const lastPhase = phases[lastPhaseIndex];

  const percentFormatter = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 2,
  });

  const form = useForm({
    defaultValues: {
      reason: "",
      winner: experiment.winner || 0,
      releasedVariationId: experiment.releasedVariationId || "",
      excludeFromPayload: !!experiment.excludeFromPayload,
      analysis: experiment.analysis || "",
      results: experiment.results || "dnf",
      dateEnded: new Date().toISOString().substr(0, 16),
    },
  });

  const { apiCall } = useAuth();

  const submit = form.handleSubmit(async (value) => {
    let winner = -1;
    if (value.results === "lost") {
      winner = 0;
    } else if (value.results === "won") {
      if (experiment.variations.length === 2) {
        winner = 1;
      } else {
        winner = value.winner;
      }
    }

    const body = {
      ...value,
      winner,
    };

    await apiCall<{ status: number; message?: string }>(
      isStopped
        ? `/experiment/${experiment.id}`
        : `/experiment/${experiment.id}/stop`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

    if (!isStopped) {
      track("停止实验", {
        result: value.results,
      });
    }

    mutate();
  });

  return (
    <Modal
      trackingEventModalType="stop-experiment-form"
      trackingEventModalSource={source}
      header={
        isStopped
          ? `Edit ${isBandit ? "Bandit" : "Experiment"} Results`
          : `Stop ${isBandit ? "Bandit" : "Experiment"}`
      }
      close={close}
      open={true}
      submit={submit}
      cta={isStopped ? "保存" : "停止"}
      submitColor={isStopped ? "primary" : "danger"}
      closeCta="取消"
    >
      {!isStopped && (
        <>
          <Field
            label="停止原因"
            textarea
            {...form.register("reason")}
            placeholder="(可选)"
          />
          {!hasLinkedChanges && (
            <Field
              label="停止时间（UTC）"
              type="datetime-local"
              {...form.register("dateEnded")}
            />
          )}
        </>
      )}
      <div className="row">
        <SelectField
          label="结论"
          containerClassName="col-lg"
          value={form.watch("results")}
          onChange={(v) => {
            const result = v as ExperimentResultsType;
            form.setValue("results", result);

            if (result === "dnf" || result === "inconclusive") {
              form.setValue("excludeFromPayload", true);
              form.setValue("releasedVariationId", "");
              form.setValue("winner", 0);
            } else if (result === "won") {
              form.setValue("excludeFromPayload", false);
              form.setValue("winner", 1);
              form.setValue(
                "releasedVariationId",
                experiment.variations[1]?.id || ""
              );
            } else if (result === "lost") {
              form.setValue("excludeFromPayload", true);
              form.setValue("winner", 0);
              form.setValue(
                "releasedVariationId",
                experiment.variations[0]?.id || ""
              );
            }
          }}
          placeholder="请选择一个..."
          required
          options={[
            { label: "未完成", value: "dnf" },
            { label: "获胜", value: "won" },
            { label: "失败", value: "lost" },
            { label: "不确定", value: "inconclusive" },
          ]}
        />
        {form.watch("results") === "won" && experiment.variations.length > 2 && (
          <SelectField
            label="获胜者"
            containerClassName="col-lg"
            value={form.watch("winner") + ""}
            onChange={(v) => {
              form.setValue("winner", parseInt(v) || 0);

              form.setValue(
                "releasedVariationId",
                experiment.variations[parseInt(v)]?.id ||
                form.watch("releasedVariationId")
              );
            }}
            options={experiment.variations.slice(1).map((v, i) => {
              return { value: i + 1 + "", label: v.name };
            })}
          />
        )}
      </div>
      {hasLinkedChanges && (
        <>
          <div className="row">
            <div className="form-group col">
              <label>启用临时推出</label>

              <div>
                <Toggle
                  id="excludeFromPayload"
                  value={!form.watch("excludeFromPayload")}
                  setValue={(includeInPayload) => {
                    form.setValue("excludeFromPayload", !includeInPayload);
                  }}
                />
              </div>

              <small className="form-text text-muted">
                保持{isBandit ? "老虎机" : "实验"}运行，直到您可以在代码中实现这些变更。{" "}
                <DocLink docSection="temporaryRollout">了解更多</DocLink>
              </small>
            </div>
          </div>

          {!form.watch("excludeFromPayload") &&
            (lastPhase?.coverage ?? 1) < 1 ? (
            <div className="alert alert-warning">
              <FaExclamationTriangle className="mr-1" />
              当前只有< strong>{percentFormatter.format(lastPhase.coverage)}</strong>的流量指向此实验。推出时，< strong>100%</strong>的流量将指向已发布的版本。
            </div>
          ) : null}

          {!form.watch("excludeFromPayload") ? (
            <div className="row">
              <SelectField
                label="要发布的版本"
                containerClassName="col"
                value={form.watch("releasedVariationId")}
                onChange={(v) => {
                  form.setValue("releasedVariationId", v);
                }}
                helpText="将100%的实验流量发送到此版本"
                placeholder="请选择一个..."
                required
                options={experiment.variations.map((v) => {
                  return { value: v.id, label: v.name };
                })}
              />
            </div>
          ) : form.watch("results") === "won" ? (
            <div className="alert alert-info">
              如果您不启用临时推出，在提交此表单时，所有实验流量将立即恢复到默认的控制体验。
            </div>
          ) : null}
        </>
      )}

      <div className="row">
        <div className="form-group col-lg">
          <label>额外分析或详细信息</label>{" "}
          <MarkdownInput
            value={form.watch("analysis")}
            setValue={(val) => form.setValue("analysis", val)}
          />
        </div>
      </div>
    </Modal>
  );
};

export default StopExperimentForm;

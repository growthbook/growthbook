import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "back-end/types/experiment";
import { useState } from "react";
import { PiCaretDown, PiCaretUp } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import { validateSavedGroupTargeting } from "@/components/Features/SavedGroupTargetingField";

export interface Props {
  close: () => void;
  i: number;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  editTargeting: (() => void) | null;
  source?: string;
}

export default function EditPhaseModal({
  close,
  i,
  experiment,
  mutate,
  editTargeting,
  source,
}: Props) {
  const form = useForm<ExperimentPhaseStringDates>({
    defaultValues: {
      ...experiment.phases[i],
      seed: experiment.phases[i].seed ?? experiment.trackingKey,
      dateStarted: (experiment.phases[i].dateStarted ?? "").substr(0, 16),
      dateEnded: experiment.phases[i].dateEnded
        ? (experiment.phases[i].dateEnded ?? "").substr(0, 16)
        : "",
    },
  });
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);

  const { apiCall } = useAuth();

  const isDraft = experiment.status === "draft";
  const isMultiPhase = experiment.phases.length > 1;

  return (
    <Modal
      trackingEventModalType="edit-phase-modal"
      trackingEventModalSource={source}
      open={true}
      close={close}
      header={`编辑分析阶段 #${i + 1}`}
      submit={form.handleSubmit(async (value) => {
        validateSavedGroupTargeting(value.savedGroups);

        await apiCall(`/experiment/${experiment.id}/phase/${i}`, {
          method: "PUT",
          body: JSON.stringify(value),
        });
        mutate();
      })}
      size="lg"
      bodyClassName="px-4 pt-4"
    >
      <Field label="阶段名称" {...form.register("name")} required />
      <Field
        label="开始时间（UTC）"
        type="datetime-local"
        {...form.register("dateStarted")}
      />
      {!(isDraft && !isMultiPhase) ? (
        <>
          <Field
            label="结束时间（UTC）"
            type="datetime-local"
            {...form.register("dateEnded")}
            helpText={
              <>
                如果仍在运行则留空。{" "}
                <a
                  role="button"
                  className="a"
                  onClick={(e) => {
                    e.preventDefault();
                    form.setValue("dateEnded", "");
                  }}
                >
                  清除输入
                </a>
              </>
            }
          />
          {form.watch("dateEnded") && (
            <Field
              label="停止原因"
              textarea
              {...form.register("reason")}
              placeholder="(可选)"
            />
          )}
        </>
      ) : null}

      {!isDraft && (
        <div className="alert alert-info mt-4">
          想要更改定向规则、流量分配或开启新阶段？请改用{" "}
          <a
            role="button"
            className="a"
            onClick={() => {
              editTargeting?.();
              close();
            }}
          >
            变更
          </a>{" "}
          按钮。
        </div>
      )}

      {advancedOptionsOpen && (
        //edit seed
        <Field
          label="种子（Seed）"
          type="input"
          {...form.register("seed")}
          helpText={
            <>
              <strong className="text-danger">警告：</strong>更改此项将重新随机分配实验流量。
            </>
          }
        />
      )}
      <span
        className="ml-auto link-purple cursor-pointer"
        onClick={(e) => {
          e.preventDefault();
          setAdvancedOptionsOpen(!advancedOptionsOpen);
        }}
      >
        高级选项{" "}
        {!advancedOptionsOpen ? <PiCaretDown /> : <PiCaretUp />}
      </span>
    </Modal>
  );
}

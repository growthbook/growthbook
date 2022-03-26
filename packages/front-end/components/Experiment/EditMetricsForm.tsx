import React, { FC, useState } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import Modal from "../Modal";
import MetricsSelector from "./MetricsSelector";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const EditMetricsForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
}> = ({ experiment, cancel, mutate }) => {
  const form = useForm({
    defaultValues: {
      metrics: experiment.metrics || [],
      guardrails: experiment.guardrails || [],
      activationMetric: experiment.activationMetric || "",
    },
  });
  const { apiCall } = useAuth();
  const [adjustOrder, setAdjustOrder] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  function getMetricIndex(metric: string) {
    for (let i = 0; i < form.watch("metrics").length; i++) {
      if (form.watch("metrics")[i] === metric) return i;
    }
    return -1;
  }

  return (
    <Modal
      autoFocusSelector=""
      header={"Edit Metrics"}
      open={true}
      close={cancel}
      submit={form.handleSubmit(async (value) => {
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        mutate();
      })}
      cta="Save"
    >
      {adjustOrder && form.watch("metrics").length > 0 ? (
        <>
          <div className="mb-3">
            <a
              href="#"
              className="float-right"
              onClick={(e) => {
                e.preventDefault();
                setAdjustOrder(false);
              }}
            >
              Adjust metrics
            </a>
            <h5>Drag the metrics to adjust the order</h5>
          </div>
          <div>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={async ({ active, over }) => {
                if (active.id !== over.id) {
                  const oldIndex = getMetricIndex(active.id);
                  const newIndex = getMetricIndex(over.id);
                  if (oldIndex === -1 || newIndex === -1) return;

                  const newMetrics = arrayMove(
                    form.watch("metrics"),
                    oldIndex,
                    newIndex
                  );
                  form.setValue("metrics", newMetrics);
                }
              }}
            >
              <SortableContext
                items={form.watch("metrics")}
                strategy={verticalListSortingStrategy}
              >
                {form.watch("metrics").map((met, i) => (
                  <SortableMetric key={met} metric={met} i={i} />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </>
      ) : (
        <>
          <div className="form-group">
            <label className="font-weight-bold mb-1">Goal Metrics</label>
            <a
              href="#"
              className="float-right"
              onClick={(e) => {
                e.preventDefault();
                setAdjustOrder(true);
              }}
            >
              Adjust metric order
            </a>
            <div className="mb-1 font-italic">
              Metrics you are trying to improve with this experiment.
            </div>
            <MetricsSelector
              selected={form.watch("metrics")}
              onChange={(metrics) => form.setValue("metrics", metrics)}
              datasource={experiment.datasource}
            />
          </div>
          <div className="form-group">
            <label className="font-weight-bold mb-1">Guardrail Metrics</label>
            <div className="mb-1 font-italic">
              Metrics you want to monitor, but are NOT specifically trying to
              improve.
            </div>
            <MetricsSelector
              selected={form.watch("guardrails")}
              onChange={(metrics) => form.setValue("guardrails", metrics)}
              datasource={experiment.datasource}
            />
          </div>
          <div style={{ height: 100 }} />
        </>
      )}
    </Modal>
  );
};

export function SortableMetric(props: { i: number; metric: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    active,
  } = useSortable({ id: props.metric });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: active?.id === props.metric ? 0.5 : 1,
    cursor: "grab",
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div className="p-2 my-1 border">
        {props.i + 1}. {props.metric}
      </div>
    </div>
  );
}

export default EditMetricsForm;

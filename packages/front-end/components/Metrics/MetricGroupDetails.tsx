import React, { useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
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
import { MetricGroupInterface } from "shared/types/metric-groups";
import { CSS } from "@dnd-kit/utilities";
import { GrDrag } from "react-icons/gr";
import Link from "next/link";
import { ExperimentMetricInterface, isFactMetric } from "shared/experiments";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
//import track from "@/services/track";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useDefinitions } from "@/services/DefinitionsContext";
import FactMetricTypeDisplayName from "@/components/Metrics/FactMetricTypeDisplayName";

export default function MetricGroupDetails({
  metricGroup,
  mutate,
}: {
  metricGroup: MetricGroupInterface;
  mutate: () => void;
}) {
  const { apiCall } = useAuth();
  const [activeId, setActiveId] = useState<string | null>(null);
  const permissionsUtil = usePermissionsUtil();
  const { getMetricById, getFactMetricById } = useDefinitions();
  const factMetricsInList: string[] = [];
  const metricObjs: ExperimentMetricInterface[] = metricGroup.metrics
    .map((id) => {
      const mi = getMetricById(id);
      if (mi) return mi;
      const fm = getFactMetricById(id);
      if (fm) {
        factMetricsInList.push(id);
        return fm;
      }
    })
    .filter((m) => m) as ExperimentMetricInterface[];

  const [items, setItems] = useState(metricObjs.length ? metricObjs : []);
  useEffect(() => {
    setItems(metricObjs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(metricObjs)]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  function getMetricIndex(id: string) {
    if (!items || !items.length) return -1;
    for (let i = 0; i < items.length; i++) {
      if (!items[i]) continue;
      if (items[i].id === id) {
        return i;
      }
    }
    return -1;
  }
  const canEdit = permissionsUtil.canCreateMetricGroup();
  const activeMetric = activeId ? items[getMetricIndex(activeId)] : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={async ({ active, over }) => {
        if (!canEdit) {
          setActiveId(null);
          return;
        }

        if (over && active.id !== over.id) {
          const oldIndex = getMetricIndex(active.id);
          const newIndex = getMetricIndex(over.id);

          if (oldIndex === -1 || newIndex === -1) return;

          const newMetrics = arrayMove(items, oldIndex, newIndex);

          setItems(newMetrics);
          await apiCall<{ version: number }>(
            `/metric-group/${metricGroup.id}/reorder`,
            {
              method: "PUT",
              body: JSON.stringify({
                from: oldIndex,
                to: newIndex,
              }),
            },
          ).then(async () => {
            await mutate();
          });
        }
        setActiveId(null);
      }}
      onDragStart={({ active }) => {
        if (!canEdit) {
          return;
        }
        setActiveId(active.id);
      }}
    >
      <table style={{ borderCollapse: "separate", borderSpacing: "0" }}>
        <thead>
          <tr>
            <th style={{ width: "3%" }}></th>
            <th className="text-center" style={{ width: "3%" }}>
              Order
            </th>
            <th style={{ width: "34%" }}>Metric</th>
            <th style={{ width: "27%" }}>Type</th>
            <th style={{ width: "30%" }}>Datasource</th>
            <th style={{ width: "3%" }}></th>
          </tr>
        </thead>
        <tbody>
          <SortableContext items={items} strategy={verticalListSortingStrategy}>
            {items.map(({ ...m }, i) => (
              <SortableMetricRow
                key={m.id}
                i={i}
                metricGroupId={metricGroup.id}
                metric={m}
                mutate={mutate}
                factMetricsInList={factMetricsInList}
              />
            ))}
          </SortableContext>
        </tbody>
      </table>
      <DragOverlay>
        {activeMetric && (
          <table style={{ width: "100%" }}>
            <tbody>
              <tr
                style={{
                  backgroundColor: "var(--background-color)",
                  opacity: "0.8",
                  boxShadow:
                    "rgba(0, 0, 0, 0.1) 0px 20px 25px -5px, rgba(0, 0, 0, 0.3) 0px 10px 10px -5px",
                  outline: "#3e1eb3 solid 1px",
                }}
              >
                <MetricRow
                  i={getMetricIndex(activeId as string)}
                  metric={activeMetric}
                  metricGroupId={metricGroup.id}
                  factMetricsInList={factMetricsInList}
                />
              </tr>
            </tbody>
          </table>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function SortableMetricRow(props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.metric.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <tr ref={setNodeRef} style={style}>
      {isDragging ? (
        <td
          colSpan={8}
          style={{
            backgroundColor: "rgba(74, 17, 189, 0.20)",
            padding: "20px",
            boxShadow: "inset 0 3px 5px rgba(0,0,0,0.2)",
          }}
        >
          &nbsp;
        </td>
      ) : (
        <MetricRow
          {...props}
          handle={{ ...attributes, ...listeners }}
          isDragging={isDragging}
        />
      )}
    </tr>
  );
}

interface SortableProps {
  metric: ExperimentMetricInterface;
  metricGroupId: string;
  i: number;
  mutate?: () => void;
}

type MetricRowProps = SortableProps &
  React.HTMLAttributes<HTMLDivElement> & {
    handle?: React.HTMLAttributes<HTMLDivElement>;
    isDragging?: boolean;
    factMetricsInList: string[];
  };

function MetricRow({
  i,
  metricGroupId,
  metric,
  handle,
  isDragging,
  mutate,
  factMetricsInList,
}: MetricRowProps) {
  const { getDatasourceById } = useDefinitions();
  const { apiCall } = useAuth();
  const metricUrl = factMetricsInList.includes(metric.id)
    ? `/fact-metrics/${metric.id}`
    : `/metric/${metric.id}`;
  return (
    <>
      <td className="p-0" style={{ width: "3%" }}>
        <div
          {...handle}
          title="Drag and drop to re-order metric"
          className="d-flex justify-content-end"
          style={{
            cursor: isDragging ? "grabbing" : "grab",
            padding: "0.7rem",
          }}
        >
          <GrDrag />
        </div>
      </td>
      <td className="text-center" style={{ width: "3%" }}>
        {i + 1}
      </td>
      <td style={{ width: "34%" }}>
        <Link href={metricUrl}>{metric.name}</Link>
      </td>
      <td style={{ width: "27%" }}>
        {isFactMetric(metric) ? (
          <FactMetricTypeDisplayName type={metric.metricType} />
        ) : (
          metric.type
        )}
      </td>
      <td style={{ width: "30%" }}>
        {metric.datasource ? getDatasourceById(metric.datasource)?.name : ""}
      </td>
      <td style={{ width: "3%" }}>
        <DeleteButton
          className="dropdown-item text-danger"
          displayName="Metric from Group"
          deleteMessage="Remove this metric from the group?"
          useIcon={true}
          onClick={async () => {
            await apiCall<{ version: number }>(
              `/metric-group/${metricGroupId}/remove/${metric.id}`,
              {
                method: "DELETE",
              },
            ).then(async () => {
              if (mutate) {
                await mutate();
              }
            });
          }}
        />
      </td>
    </>
  );
}

MetricRow.displayName = "MetricRow";

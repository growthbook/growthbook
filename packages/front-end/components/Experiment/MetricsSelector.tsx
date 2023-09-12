import { CSSProperties, FC, HTMLAttributes, forwardRef, useState } from "react";
import { isProjectListValidForProject } from "shared/util";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MdOutlineDragIndicator } from "react-icons/md";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove } from "react-sortable-hoc";
import { FaTimes } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "../Tooltip/Tooltip";
import MetricTooltipBody from "../Metrics/MetricTooltipBody";
import OverflowText from "./TabbedPage/OverflowText";

const METRIC_WIDTH = 195;

const SelectedMetric = forwardRef<
  HTMLDivElement,
  {
    id: string;
    style?: CSSProperties;
    handle?: HTMLAttributes<HTMLDivElement>;
    removeMetric: (id: string) => void;
  }
>(function SelectedMetric({ id, style, handle, removeMetric }, ref) {
  const { getMetricById } = useDefinitions();
  const metric = getMetricById(id);
  return (
    <div style={style} ref={ref}>
      <div className="d-flex badge badge-purple border mb-2 mr-2 p-2 rounded text-left">
        <div
          {...handle}
          title="Drag and drop to re-order metrics"
          className="mr-1"
        >
          <MdOutlineDragIndicator />
        </div>
        <div style={{ width: METRIC_WIDTH }}>
          <Tooltip
            body={
              metric ? <MetricTooltipBody metric={metric} newUi={true} /> : ""
            }
          >
            <OverflowText maxWidth={METRIC_WIDTH}>
              <span>{metric?.name || id}</span>
            </OverflowText>
          </Tooltip>
        </div>
        <div>
          <a
            href="#"
            className="text-danger"
            style={{ fontSize: "1em" }}
            title="Remove metric"
            onClick={(e) => {
              e.preventDefault();
              removeMetric(id);
            }}
          >
            <FaTimes />
          </a>
        </div>
      </div>
    </div>
  );
});

function DraggableMetric({
  id,
  removeMetric,
}: {
  id: string;
  removeMetric: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    active,
  } = useSortable({ id: id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: active?.id === id ? 0.3 : 1,
  };

  return (
    <SelectedMetric
      ref={setNodeRef}
      id={id}
      handle={{ ...listeners, ...attributes }}
      style={style}
      removeMetric={removeMetric}
    />
  );
}

function MetricDragArea({
  selected,
  setSelected,
}: {
  selected: string[];
  setSelected: (selected: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  const removeMetric = (id: string) => {
    setSelected(selected.filter((s) => s !== id));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={async ({ active, over }) => {
        if (active.id !== over?.id) {
          const oldIndex = selected.findIndex((s) => s === active.id);
          const newIndex = selected.findIndex((s) => s === over?.id);

          if (oldIndex === -1 || newIndex === -1) return;

          const newSelected = arrayMove(selected, oldIndex, newIndex);

          setSelected(newSelected);
        }
        setActiveId(null);
      }}
      onDragStart={({ active }) => {
        setActiveId(active.id);
      }}
      onDragCancel={() => {
        setActiveId(null);
      }}
    >
      <div className="d-flex flex-wrap">
        <SortableContext items={selected}>
          {selected.map((id) => (
            <DraggableMetric id={id} key={id} removeMetric={removeMetric} />
          ))}
        </SortableContext>
        <DragOverlay>
          {activeId ? (
            <SelectedMetric id={activeId} removeMetric={removeMetric} />
          ) : null}
        </DragOverlay>
      </div>
    </DndContext>
  );
}

const MetricsSelector: FC<{
  datasource?: string;
  project?: string;
  selected: string[];
  onChange: (metrics: string[]) => void;
  autoFocus?: boolean;
}> = ({ datasource, project, selected, onChange, autoFocus }) => {
  const [filter, setFilter] = useState("");

  const { metrics, getMetricById } = useDefinitions();
  const projectMetrics = metrics
    .filter((m) => (datasource ? m.datasource === datasource : true))
    .filter((m) => isProjectListValidForProject(m.projects, project));

  const filteredMetrics = projectMetrics
    .filter((m) => !filter || m.tags?.includes(filter))
    .filter((m) => !selected.includes(m.id));

  const tagCounts: Record<string, number> = {};
  filteredMetrics.forEach((m) => {
    if (m.tags) {
      m.tags.forEach((t) => {
        tagCounts[t] = tagCounts[t] || 0;
        tagCounts[t]++;
      });
    }
  });

  const hasTags = projectMetrics.some((m) => m.tags?.length);

  const filterOptions = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({
      value: tag,
      label: `${tag} (${count})`,
    }));

  return (
    <div className="bg-light appbox">
      {selected.length > 0 && (
        <div
          className="border-bottom px-2 pt-2"
          style={{ maxHeight: 210, overflowY: "auto" }}
        >
          <MetricDragArea selected={selected} setSelected={onChange} />
        </div>
      )}
      <div className="p-2">
        <div className="row align-items-center">
          {filteredMetrics.length > 0 && hasTags ? (
            <div
              className="col-auto"
              title={
                !filterOptions.length
                  ? "All metrics with tags have already been added"
                  : ""
              }
            >
              <SelectField
                options={filterOptions}
                value={filter}
                onChange={(f) => {
                  setFilter(f);
                }}
                initialOption="Filter by Tag..."
                disabled={!filterOptions.length}
              />
            </div>
          ) : null}
          <div className="col-auto">
            {filteredMetrics.length > 0 ? (
              <SelectField
                value={""}
                onChange={(m) => {
                  if (m === "$all") {
                    onChange([
                      ...selected,
                      ...filteredMetrics.map((m) => m.id),
                    ]);
                    setFilter("");
                  } else if (m) {
                    onChange([...selected, m]);
                    if (filteredMetrics.length === 1) setFilter("");
                  }
                }}
                autoFocus={autoFocus}
                closeMenuOnSelect={false}
                options={[
                  ...(filter
                    ? [
                        {
                          value: "$all",
                          label: `Add All Metrics (${filteredMetrics.length})`,
                        },
                      ]
                    : []),
                  ...filteredMetrics.map((m) => ({
                    value: m.id,
                    label: m.name,
                  })),
                ]}
                formatOptionLabel={({ value, label }) => {
                  if (value === "$all") {
                    return <strong>{label}</strong>;
                  }
                  if (!value) {
                    return label;
                  }

                  const metric = getMetricById(value);
                  if (!metric) return label;

                  return (
                    <div>
                      <strong>{metric.name}</strong>
                      {metric.description && (
                        <div className="small">
                          <OverflowText
                            maxWidth={400}
                            title={metric.description}
                          >
                            {metric.description}
                          </OverflowText>
                        </div>
                      )}
                      <div className="d-flex">
                        <div className="mr-2">
                          <em>{metric.type}</em>
                        </div>
                        {metric.denominator && (
                          <div className="mr-2">
                            <em>ratio</em>
                          </div>
                        )}
                        {metric.inverse && (
                          <div className="mr-2">
                            <em>inverse</em>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }}
                initialOption="Add Metrics..."
                hideSelectedOption={true}
              />
            ) : (
              <em>All metrics selected</em>
            )}
          </div>
          {selected.length > 0 && (
            <div className="col-auto ml-auto">
              <a
                href="#"
                className="text-danger small"
                onClick={(e) => {
                  e.preventDefault();
                  onChange([]);
                }}
              >
                remove all
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MetricsSelector;

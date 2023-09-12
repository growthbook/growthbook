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
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField from "@/components/Forms/SelectField";
import OverflowText from "./TabbedPage/OverflowText";

const METRIC_WIDTH = 200;

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
        <OverflowText
          maxWidth={METRIC_WIDTH}
          style={{ width: METRIC_WIDTH }}
          title={metric?.name || id}
        >
          <span className="text-purple">{metric?.name || id}</span>
        </OverflowText>
        <div>
          <a
            href="#"
            className="text-danger"
            title="Remove metric"
            onClick={(e) => {
              e.preventDefault();
              removeMetric(id);
            }}
          >
            &times;
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

  const { metrics } = useDefinitions();
  const projectMetrics = metrics
    .filter((m) => (datasource ? m.datasource === datasource : true))
    .filter((m) => isProjectListValidForProject(m.projects, project));

  const filteredMetrics = projectMetrics
    .filter((m) => !filter || m.tags?.includes(filter))
    .filter((m) => !selected.includes(m.id));

  const tagCounts: Record<string, number> = {};
  projectMetrics.forEach((m) => {
    if (m.tags) {
      m.tags.forEach((t) => {
        tagCounts[t] = tagCounts[t] || 0;
        tagCounts[t]++;
      });
    }
  });

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
          {filterOptions.length > 0 ? (
            <div className="col-auto">
              <SelectField
                options={filterOptions}
                value={filter}
                onChange={(f) => {
                  setFilter(f);
                }}
                initialOption="All Tags"
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
                  }
                }}
                autoFocus={autoFocus}
                options={[
                  ...(filter
                    ? [
                        {
                          value: "$all",
                          label: `All Metrics (${filteredMetrics.length})`,
                        },
                      ]
                    : []),
                  ...filteredMetrics.map((m) => ({
                    value: m.id,
                    label: m.name,
                  })),
                ]}
                initialOption="Select Metrics..."
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

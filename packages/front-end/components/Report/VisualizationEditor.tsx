import { FC } from "react";
import {
  Visualization as VisInterface,
  QueryResult,
} from "../../types/reports";
import Visualization from "./Visualization";

const allowedTypes = ["LineChart", "BarChart", "AreaChart"];

const VisualizationEditor: FC<{
  visualization: VisInterface;
  data: QueryResult;
  updateVisualization: (changes: Partial<VisInterface>) => void;
}> = ({ visualization, data, updateVisualization }) => {
  if (!data.rows.length) {
    return (
      <div>
        <em>Run your query first before adding a visualization.</em>
      </div>
    );
  }

  const { type, title, xAxis, yAxis } = visualization;

  const colOptions = Object.keys(data.rows[0]).map((col) => (
    <option key={col}>{col}</option>
  ));

  let editorOptions;
  if (["LineChart", "BarChart", "AreaChart"].includes(type)) {
    editorOptions = (
      <>
        <div className="form-group">
          X-Axis:
          <select
            value={xAxis[0]}
            className="form-control"
            onChange={(e) => updateVisualization({ xAxis: [e.target.value] })}
          >
            <option value=""></option>
            {colOptions}
          </select>
        </div>
        <div className="form-group">
          Y-Axis:
          <select
            value={yAxis[0]}
            className="form-control"
            onChange={(e) => updateVisualization({ yAxis: [e.target.value] })}
          >
            <option value=""></option>
            {colOptions}
          </select>
        </div>
      </>
    );
  }

  return (
    <div className="row py-2">
      <div className="col-xl-2 col-lg-3 col-md-4">
        <div className="form-group">
          Title:{" "}
          <input
            type="text"
            className="form-control"
            value={title}
            onChange={(e) => updateVisualization({ title: e.target.value })}
          />
        </div>
        <div className="form-group">
          Type:
          <select
            className="form-control"
            value={type}
            onChange={(e) => updateVisualization({ type: e.target.value })}
          >
            {allowedTypes.map((t) => (
              <option value={t} key={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        {editorOptions}
      </div>
      <div className="col">
        <Visualization visualization={visualization} data={data} />
      </div>
    </div>
  );
};

export default VisualizationEditor;

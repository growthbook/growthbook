import { FC, Fragment } from "react";
import { Typeahead } from "react-bootstrap-typeahead";
import { useDefinitions } from "../../services/DefinitionsContext";
import { FaQuestionCircle } from "react-icons/fa";
import Tooltip from "../Tooltip";

const MetricsSelector: FC<{
  datasource?: string;
  selected: string[];
  onChange: (metrics: string[]) => void;
}> = ({ datasource, selected, onChange }) => {
  const { metrics, getMetricById } = useDefinitions();

  const validMetrics = metrics.filter(
    (m) => !datasource || m.datasource === datasource
  );

  const toMetricValue = (id: string) => {
    return {
      id,
      name: getMetricById(id)?.name,
    };
  };

  const metricTags = new Map();
  validMetrics.forEach((m) => {
    if (m.tags) {
      m.tags.forEach((t) => {
        if (metricTags.has(t)) {
          metricTags.set(t, [...metricTags.get(t), m]);
        } else {
          metricTags.set(t, [m.id]);
        }
      });
    }
  });

  // keep track of any tags which have been used.
  const usedTags = [];
  metricTags.forEach((mArr, tagName) => {
    let used = true;
    mArr.forEach((m) => {
      if (!selected.includes(m)) {
        used = false;
      }
    });
    if (used) {
      usedTags.push(tagName);
    }
  });

  const selectMetricFromTag = [];
  if (metricTags.size < 6) {
    // use buttons:
    metricTags.forEach((mArr, tagName) => {
      selectMetricFromTag.push(
        <a
          className={`badge badge-secondary mx-2 cursor-pointer ${
            usedTags.includes(tagName) ? "badge-used" : ""
          }`}
          onClick={(e) => {
            e.preventDefault();
            const tmp = [...selected];
            mArr.forEach((m) => {
              if (!tmp.includes(m)) {
                tmp.push(m);
              }
            });
            onChange(tmp);
          }}
        >
          {tagName} <span className="badge badge-light">{mArr.length}</span>
        </a>
      );
    });
  } else {
    // use select html:
    const options = [];
    options.push(<option value="...">...</option>);
    metricTags.forEach((mArr, tagName) => {
      options.push(
        <option value={tagName}>
          {tagName} ({mArr.length})
        </option>
      );
    });
    selectMetricFromTag.push(
      <select
        placeholder="..."
        value="..."
        className="form-control ml-3"
        onChange={(e) => {
          const tmp = [...selected];
          if (metricTags.has(e.target.value)) {
            metricTags.get(e.target.value).forEach((m) => {
              if (!tmp.includes(m)) {
                tmp.push(m);
              }
            });
          }
          onChange(tmp);
        }}
      >
        {options.map((o, i) => {
          return <Fragment key={i}>{o}</Fragment>;
        })}
      </select>
    );
  }

  return (
    <>
      <Typeahead
        id="experiment-metrics"
        labelKey="name"
        multiple={true}
        options={validMetrics.map((m) => {
          return {
            id: m.id,
            name: m.name,
          };
        })}
        onChange={(selected: { id: string; name: string }[]) => {
          onChange(selected.map((s) => s.id));
        }}
        selected={selected.map(toMetricValue)}
        placeholder="Select metrics..."
      />
      {metricTags.size > 0 && (
        <div className="metric-from-tag text-muted form-inline mt-2">
          <span style={{ fontSize: "0.82rem" }}>
            Select metric by tag:{" "}
            <Tooltip text="Metrics can be tagged for grouping. Select any tag to add those metrics">
              <FaQuestionCircle />
            </Tooltip>
          </span>
          {selectMetricFromTag.map((s, i) => {
            return <Fragment key={i}>{s}</Fragment>;
          })}
        </div>
      )}
    </>
  );
};

export default MetricsSelector;

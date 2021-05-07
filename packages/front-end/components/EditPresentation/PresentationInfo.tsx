import React from "react";
import useApi from "../../hooks/useApi";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { PresentationInterface } from "back-end/types/presentation";
import StatusIndicator from "../Experiment/StatusIndicator";

export default function PresentationInfo({
  showForm,
  handleChange,
  presentationData,
}: {
  showForm: boolean;
  handleChange: (p: PresentationInterface) => void;
  presentationData: PresentationInterface;
}): React.ReactElement {
  const { data } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>("/experiments");

  if (!showForm) return <></>;

  if (!data) return <></>;

  // get the list of experiments in the right shape:
  const existingExperiments = [];
  if (data && data.experiments.length) {
    for (let i = 0; i < data.experiments.length; i++) {
      //if(ExperimentInfo)
      existingExperiments.push({
        id: data.experiments[i].id,
        name: data.experiments[i].name,
      });
    }
  }

  const presentationDataChange = (e) => {
    const { name, value } = e.target;
    let newVal = value;
    if (name === "tags") {
      const t = value.split(",");
      for (let i = 0; i < t.length; i++) {
        if (i === t.length - 1) {
          // allow for spaces in tag names
          t[i] = t[i].trimStart().replace(/\s+$/, " ");
        } else {
          t[i] = t[i].trim();
        }
      }
      newVal = t;
    }
    console.log("data was", presentationData);
    const tmp = { ...presentationData, [name]: newVal };
    console.log("now", tmp);
    // pass back to parent
    handleChange(tmp);
  };
  console.log(presentationData);
  const selectedExperiments = new Map();
  presentationData.experimentIds.map((id: string, ind: number) => {
    selectedExperiments.set(id, ind + 1);
  });
  const setSelectedExperiments = (exp: ExperimentInterfaceStringDates) => {
    if (selectedExperiments.has(exp.id)) {
      selectedExperiments.delete(exp.id);
    } else {
      selectedExperiments.set(exp.id, selectedExperiments.size);
    }
    const tmp = {
      ...presentationData,
      experimentIds: Array.from(selectedExperiments.keys()),
    };
    handleChange(tmp);
  };

  return (
    <>
      <div className="form-group">
        <label>Presentation Title</label>
        <input
          type="text"
          name="title"
          className="form-control"
          onChange={presentationDataChange}
          value={presentationData.title}
          placeholder=""
        />
      </div>
      <div className="form-group">
        <label>More Details (optional)</label>
        <textarea
          name="description"
          className="form-control"
          value={presentationData.description}
          onChange={presentationDataChange}
        ></textarea>
        <small id="emailHelp" className="form-text text-muted">
          (for your notes, not used in the presentation)
        </small>
      </div>
      <div className="form-group">
        <label>Select Experiments to Present</label>
        <div className="modal-dialog-scrollable flex-wrap scrollarea">
          {data.experiments.map((exp, i) => (
            <div
              className={`card mb-4 selectalble ${
                selectedExperiments.has(exp.id) ? "selected" : ""
              }`}
              key={i}
              onClick={() => {
                setSelectedExperiments(exp);
              }}
            >
              <div className="card-body">
                <span className="selected-number">
                  {selectedExperiments.has(exp.id)
                    ? selectedExperiments.get(exp.id)
                    : ""}
                </span>
                <h5 className="card-title">{exp.name}</h5>
                <p className="card-text">{exp.hypothesis}</p>
                <div className="metainfo">
                  <div>
                    status:{" "}
                    <StatusIndicator
                      status={exp.status}
                      archived={exp.archived}
                    />
                  </div>
                  <div className="tags text-muted">
                    <span className="mr-2">Tags:</span>
                    {exp.tags &&
                      Object.values(exp.tags).map((col) => (
                        <span
                          className="tag badge badge-secondary mr-2"
                          key={col}
                        >
                          {col}
                        </span>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

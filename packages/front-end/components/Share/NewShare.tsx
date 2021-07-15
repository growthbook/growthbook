import React, { useContext } from "react";
import PagedModal from "../Modal/PagedModal";
import Page from "../Modal/Page";
import { useState } from "react";
import { useSearch } from "../../services/search";
import { UserContext } from "../../components/ProtectedPage";
import useForm from "../../hooks/useForm";
import useApi from "../../hooks/useApi";
import Tabs from "../../components/Tabs/Tabs";
import Tab from "../../components/Tabs/Tab";
import CompactResults from "../Experiment/CompactResults";
import { useDefinitions } from "../../services/DefinitionsContext";
import { ago, datetime } from "../../services/dates";
import {
  ExperimentInterfaceStringDates,
  ExperimentSnapshotInterface,
} from "back-end/types/experiment";
import { ShareInterface, ShareOptions } from "back-end/types/share";
import ResultsIndicator from "../Experiment/ResultsIndicator";
import {
  resetServerContext,
  DragDropContext,
  Droppable,
  Draggable,
} from "react-beautiful-dnd";
import { GrDrag } from "react-icons/gr";
import { FaCheck, FaRegTrashAlt } from "react-icons/fa";
import { HexColorPicker } from "react-colorful";

const NewShare = ({
  modalState,
  setModalState,
  refreshList,
  onClose,
}: {
  modalState: boolean;
  setModalState: (state: boolean) => void;
  refreshList: () => void;
  onClose: (refresh?: boolean) => void;
}): React.ReactElement => {
  const { data, error } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>("/experiments");
  //const [expStatus, setExpStatus] = useState("stopped");
  const [step, setStep] = useState(0);
  const { getUserDisplay, permissions, userId } = useContext(UserContext);
  const [value, inputProps, manualUpdate] = useForm<Partial<ShareInterface>>({
    title: "",
    description: "",
    theme: "",
    customTheme: {
      background: "#3400a3",
      text: "#ffffff",
    },
    experimentIds: [],
    options: {},
  });

  // get snapshot data of the selected experiments:
  const { data: snapshotData } = useApi<{
    snapshots: ExperimentSnapshotInterface[];
  }>(`/experiments/snapshots/?ids=` + value.experimentIds.join(","));

  const { getMetricById } = useDefinitions();
  //@todo - add max number for shared experiments.

  const {
    list: experiments,
    searchInputProps,
    isFiltered,
  } = useSearch(data?.experiments || [], [
    "name",
    "implementation",
    "hypothesis",
    "description",
    "tags",
    "trackingKey",
    "status",
    "id",
    "owner",
    "metrics",
    "results",
    "analysis",
  ]);

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const onSubmit = async () => {};
  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!experiments) {
    return (
      <div className="alert alert-danger">
        You need some experiments to share first.
      </div>
    );
  }

  const byId = new Map();
  const byStatus: {
    archived: ExperimentInterfaceStringDates[];
    //draft: ExperimentInterfaceStringDates[];
    running: ExperimentInterfaceStringDates[];
    stopped: ExperimentInterfaceStringDates[];
    //myDrafts: ExperimentInterfaceStringDates[];
  } = {
    archived: [],
    //draft: [],
    running: [],
    stopped: [],
    //myDrafts: [],
  };
  const defaultGraph = "pill";

  experiments.forEach((test) => {
    if (test.archived) {
      byStatus.archived.push(test);
    } else if (test.status in byStatus) {
      byStatus[test.status].push(test);
    }
    byId.set(test.id, test);
  });

  const selectedExperiments = new Map();
  value.experimentIds.map((id: string) => {
    selectedExperiments.set(id, byId.get(id));
  });
  //const selectedExpSnapshots = [];
  const selectedExpSnapshots = new Map();
  if (snapshotData?.snapshots.length) {
    snapshotData.snapshots.forEach((sd) => {
      selectedExpSnapshots.set(sd.experiment, sd);
    });
  }

  const setSelectedExperiments = (exp: ExperimentInterfaceStringDates) => {
    const opts = { ...value.options };
    if (selectedExperiments.has(exp.id)) {
      selectedExperiments.delete(exp.id);
      delete opts[exp.id];
    } else {
      selectedExperiments.set(exp.id, exp);
      opts[exp.id] = {
        showScreenShots: true,
        showGraphs: true,
        graphType: defaultGraph,
        hideMetric: [],
        hideRisk: false,
      };
    }
    const tmp = {
      ...value,
      experimentIds: Array.from(selectedExperiments.keys()),
      options: opts,
    };
    manualUpdate(tmp);
  };

  const reorder = (list, startIndex, endIndex) => {
    const result = [...list.keys()];
    const [removed] = result.splice(startIndex, 1);
    result.splice(endIndex, 0, removed);
    return result;
  };

  const onDragEnd = (result) => {
    // dropped outside the list
    if (!result.destination) {
      return;
    }
    const tmp = {
      ...value,
      experimentIds: reorder(
        selectedExperiments,
        result.source.index,
        result.destination.index
      ),
    };
    manualUpdate(tmp);
  };
  const grid = 4;
  const getItemStyle = (isDragging, draggableStyle) => ({
    // some basic styles to make the items look a bit nicer
    userSelect: "none",
    padding: grid * 2,
    margin: `0 0 ${grid}px 0`,
    // change background colour if dragging
    background: isDragging ? "lightgreen" : "",

    // styles we need to apply on draggables
    ...draggableStyle,
  });
  resetServerContext();

  const tabContents = [];
  {
    Object.entries(byStatus).forEach(([status, exp]) => {
      tabContents.push(
        <Tab
          display={
            status.charAt(0).toUpperCase() + status.substr(1).toLowerCase()
          }
          anchor={status}
          count={byStatus[status].length}
        >
          {byStatus.stopped.length > 0 ? (
            <table className="table table-hover experiment-table appbox">
              <thead>
                <tr>
                  <th></th>
                  <th style={{ width: "99%" }}>Experiment</th>
                  <th>Tags</th>
                  <th>Owner</th>
                  <th>Ended</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {byStatus[status]
                  .sort(
                    (a, b) =>
                      new Date(
                        b.phases[b.phases.length - 1]?.dateEnded
                      ).getTime() -
                      new Date(
                        a.phases[a.phases.length - 1]?.dateEnded
                      ).getTime()
                  )
                  .map((e) => {
                    const phase = e.phases[e.phases.length - 1];
                    if (!phase) return null;

                    return (
                      <tr
                        key={e.id}
                        onClick={(event) => {
                          event.preventDefault();
                          setSelectedExperiments(e);
                        }}
                        className={`cursor-pointer ${
                          selectedExperiments.has(e.id) ? "selected" : ""
                        }`}
                      >
                        <td>
                          <span className="h3 mb-0 checkmark">
                            <FaCheck />
                          </span>
                        </td>
                        <td>
                          <div className="d-flex">
                            <h4 className="testname h5">
                              <a>{e.name}</a>
                            </h4>
                          </div>
                        </td>
                        <td className="nowrap">
                          {Object.values(e.tags).map((col) => (
                            <span
                              className="tag badge badge-secondary mr-2"
                              key={col}
                            >
                              {col}
                            </span>
                          ))}
                        </td>
                        <td className="nowrap">
                          {getUserDisplay(e.owner, false)}
                        </td>
                        <td
                          className="nowrap"
                          title={datetime(phase.dateEnded)}
                        >
                          {ago(phase.dateEnded)}
                        </td>
                        <td className="nowrap">
                          <ResultsIndicator results={e.results} />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          ) : (
            <div className="alert alert-info">
              No {isFiltered ? "matching" : "stopped"} experiments
            </div>
          )}
        </Tab>
      );
      // end of the byStatus loop
    });
  }
  // end tab contents

  let counter = 0;
  const selectedList = [];
  const expOptionsList = [];
  {
    selectedExperiments.forEach((exp: ExperimentInterfaceStringDates, id) => {
      selectedList.push(
        <Draggable key={id} draggableId={id} index={counter++}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.draggableProps}
              className="shared-exp-div"
              style={getItemStyle(
                snapshot.isDragging,
                provided.draggableProps.style
              )}
            >
              <div className="d-flex align-items-center">
                <span
                  className="drag-handle mr-2"
                  {...provided.dragHandleProps}
                >
                  <GrDrag />
                </span>
                <h5 className="mb-0">{exp.name}</h5>
                <div className="ml-auto">
                  <span
                    className="delete-exp cursor-pointer"
                    onClick={(e) => {
                      e.preventDefault();
                      setSelectedExperiments(exp);
                    }}
                  >
                    <FaRegTrashAlt />
                  </span>
                </div>
              </div>
            </div>
          )}
        </Draggable>
      );
      console.log(value);
      expOptionsList.push(
        <div>
          {exp.name}
          <div className="row">
            <div className="col">
              <div className="form-group form-check">
                <label className="form-check-label">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={value.options[id]?.showScreenShots}
                    onChange={(e) => {
                      const opt = { ...value.options };
                      opt[id].showScreenShots = e.target.checked;
                      const tmp = {
                        ...value,
                        options: opt,
                      };
                      manualUpdate(tmp);
                    }}
                    id="checkbox-showscreenshots"
                  />
                  Show screen shots (if avaliable)
                </label>
              </div>
              <div className="form-row form-inline">
                <div className="form-group">
                  <label className="mr-3">Graph type</label>
                  <select
                    className="form-control"
                    {...inputProps.options[id].graphType}
                  >
                    <option selected>{defaultGraph}</option>
                    <option>violin</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
          <CompactResults
            snapshot={selectedExpSnapshots.get(id)}
            experiment={exp}
            //barFillType?: "gradient" | "significant";
            barType={value.options[id].graphType}
          />
        </div>
      );
    });
  }

  if (!modalState) {
    return <></>;
  }

  return (
    <>
      <PagedModal
        header="New Share"
        close={() => setModalState(false)}
        submit={onSubmit}
        cta="Save"
        closeCta="Cancel"
        navStyle="underlined"
        navFill={true}
        size="max"
        step={step}
        setStep={setStep}
      >
        <Page display="Select Experiments">
          <div className="row new-share">
            <div className="col-sm-12 col-md-4">
              <h4>Selected experiments to share</h4>
              <div className="selected-area h-100">
                <DragDropContext onDragEnd={onDragEnd}>
                  <Droppable droppableId="droppable">
                    {(provided, snapshot) => (
                      <div
                        {...provided.droppableProps}
                        ref={provided.innerRef}
                        className=""
                      >
                        {selectedList.length ? (
                          selectedList.map((l) => {
                            return l;
                          })
                        ) : (
                          <span className="text-muted">
                            Choose from experiments on the right
                          </span>
                        )}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              </div>
            </div>
            <div className="col-sm-12 col-md-8">
              <div className="form-group">
                <div className="filters md-form row mb-3 align-items-center">
                  <div className="col">
                    <input
                      type="search"
                      className=" form-control"
                      placeholder="Search"
                      aria-controls="dtBasicExample"
                      {...searchInputProps}
                    />
                  </div>
                </div>
                <Tabs
                  defaultTab={
                    byStatus.stopped.length > 0
                      ? "Stopped"
                      : byStatus.running.length > 0
                      ? "Running"
                      : null
                  }
                >
                  {tabContents.map((con) => {
                    return con;
                  })}
                </Tabs>
              </div>
            </div>
          </div>
        </Page>
        {/* <Page display="Experiment options">
          <div className="row new-share">
            <div className="col-sm-12 col-md-4">
              <h4>Selected experiments to share</h4>
              <div className="selected-area h-100"></div>
            </div>
            <div className="col-sm-12 col-md-8">
              {expOptionsList.map((con) => {
                return con;
              })}
            </div>
          </div>
        </Page> */}
        <Page display="Sharing options">
          <div className="row new-share">
            <div className="col-sm-12 col-md-6" style={{ minHeight: "350px" }}>
              <form>
                <div className="form-group row">
                  <label
                    htmlFor="inputtitle"
                    className="col-sm-4 col-form-label text-right"
                  >
                    Title
                  </label>
                  <div className="col-sm-8">
                    <input
                      type="email"
                      className="form-control"
                      id="inputtitle"
                      placeholder=""
                      {...inputProps.title}
                    />
                  </div>
                </div>
                <div className="form-group row">
                  <label
                    htmlFor="inputdesc"
                    className="col-sm-4 col-form-label text-right"
                  >
                    Sub-title
                  </label>
                  <div className="col-sm-8">
                    <input
                      type="email"
                      className="form-control"
                      id="inputdesc"
                      placeholder=""
                      {...inputProps.description}
                    />
                  </div>
                </div>
                <div className="form-group row">
                  <label className="form-check-label col-sm-4 col-form-label text-right">
                    Enable voting
                  </label>
                  <div className="col-sm-8" style={{ verticalAlign: "middle" }}>
                    <input
                      type="checkbox"
                      className=""
                      checked={value.voting}
                      onChange={(e) => {
                        manualUpdate({ ...value, voting: e.target.checked });
                      }}
                      id="checkbox-voting"
                    />
                  </div>
                </div>
                <div className="form-group row">
                  <label
                    htmlFor=""
                    className="col-sm-4 col-form-label text-right"
                  >
                    Presentation theme
                  </label>
                  <div className="col-sm-8">
                    <select className="form-control" {...inputProps.theme}>
                      <option value="teal" selected>
                        Teal
                      </option>
                      <option value="purple">Purple</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                </div>
                {value.theme === "custom" && (
                  <div className="form-group row">
                    <div className="col text-center">
                      <label htmlFor="custombackground" className="text-center">
                        Background color
                      </label>
                      <HexColorPicker
                        onChange={(c) => {
                          const tmp = { ...value };
                          tmp.customTheme["background"] = c;
                          manualUpdate(tmp);
                        }}
                        style={{ margin: "0 auto" }}
                        color={value.customTheme?.background || ""}
                        id="custombackground"
                      />
                    </div>
                    <div className="col text-center">
                      <label htmlFor="custombackground" className="text-center">
                        Text color
                      </label>
                      <HexColorPicker
                        onChange={(c) => {
                          const tmp = { ...value };
                          tmp.customTheme["text"] = c;
                          manualUpdate(tmp);
                        }}
                        color={value.customTheme?.text || ""}
                        id="customtextcolor"
                      />
                    </div>
                  </div>
                )}
              </form>
            </div>
            <div className="col-sm-12 col-md-6">
              <h4>Preview</h4>
              <iframe
                src="http://localhost:3000/present/pres_5nw01af5km36901r?slideIndex=1&amp;stepIndex=0"
                style={{ width: "100%", border: "1px solid #999" }}
                className="h-100"
                frameBorder="0"
              ></iframe>
            </div>
          </div>
        </Page>
      </PagedModal>
    </>
  );
};

export default NewShare;

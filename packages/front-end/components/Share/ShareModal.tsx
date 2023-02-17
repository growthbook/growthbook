import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  PresentationInterface,
  PresentationSlide,
} from "back-end/types/presentation";
import {
  resetServerContext,
  DragDropContext,
  Droppable,
  Draggable,
} from "react-beautiful-dnd";
import { GrDrag } from "react-icons/gr";
import { FaCheck, FaRegTrashAlt } from "react-icons/fa";
import { FiAlertTriangle } from "react-icons/fi";
import { HexColorPicker } from "react-colorful";
import { ago, datetime, getValidDate, date } from "@/services/dates";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { useSearch } from "@/services/search";
import useApi from "@/hooks/useApi";
import track from "@/services/track";
import ResultsIndicator from "../Experiment/ResultsIndicator";
import Tab from "../Tabs/Tab";
import Tabs from "../Tabs/Tabs";
import Page from "../Modal/Page";
import PagedModal from "../Modal/PagedModal";
import Tooltip from "../Tooltip/Tooltip";
import LoadingSpinner from "../LoadingSpinner";
import SortedTags from "../Tags/SortedTags";
import Field from "../Forms/Field";
import SelectField from "../Forms/SelectField";
import Preview from "./Preview";

export const presentationThemes = {
  lblue: {
    title: "Light Blue",
    show: true,
    colors: {
      primary: "#023047", // non heading text
      secondary: "#023047", // heading text
      tertiary: "#cae9ff", // background
      quaternary: "blue", // ?
      quinary: "red", // ?
    },
    fontSizes: {
      h1: "40px",
      h2: "30px",
      header: "64px",
      paragraph: "28px",
      text: "28px",
    },
  },
  midBlue: {
    title: "Blue",
    show: true,
    colors: {
      primary: "#f1faee", // non heading text
      secondary: "#f1faee", // heading text
      tertiary: "#2c9ad1", // background
      quaternary: "blue", // ?
      quinary: "red", // ?
    },
    fontSizes: {
      h1: "40px",
      h2: "30px",
      header: "64px",
      paragraph: "28px",
      text: "28px",
    },
  },
  dblue: {
    title: "Dark Blue",
    show: true,
    colors: {
      primary: "#f1faee", // non heading text
      secondary: "#f1faee", // heading text
      tertiary: "#1d3557", // background
      quaternary: "blue", // ?
      quinary: "red", // ?
    },
    fontSizes: {
      h1: "40px",
      h2: "30px",
      header: "64px",
      paragraph: "28px",
      text: "28px",
    },
  },
  red: {
    title: "Red",
    show: true,
    colors: {
      primary: "#fff", // non heading text
      secondary: "#fff", // heading text
      tertiary: "#d90429", // background
      quaternary: "blue", // ?
      quinary: "red", // ?
    },
    fontSizes: {
      h1: "40px",
      h2: "30px",
      header: "64px",
      paragraph: "28px",
      text: "28px",
    },
  },
  purple: {
    title: "Purple",
    show: true,
    colors: {
      primary: "#fff", // non heading text
      secondary: "#fff", // heading text
      tertiary: "#320a80", // background
      quaternary: "blue", // ?
      quinary: "red", // ?
    },
    fontSizes: {
      h1: "40px",
      h2: "30px",
      header: "64px",
      paragraph: "28px",
      text: "28px",
    },
  },
  green: {
    title: "Green",
    show: true,
    colors: {
      primary: "#fff", // non heading text
      secondary: "#fff", // heading text
      tertiary: "#006466", // background
      quaternary: "blue", // ?
      quinary: "red", // ?
    },
    fontSizes: {
      h1: "40px",
      h2: "30px",
      header: "64px",
      paragraph: "28px",
      text: "28px",
    },
  },
  custom: {
    title: "Custom",
    show: true,
    colors: {
      primary: "#444", // non heading text
      secondary: "#444", // heading text
      tertiary: "#FFF", // background
    },
    fontSizes: {
      h1: "40px",
      h2: "30px",
      header: "64px",
      paragraph: "28px",
      text: "28px",
    },
  },
};
export const defaultTheme = "purple";

const ShareModal = ({
  modalState,
  setModalState,
  title = "New Presentation",
  existing,
  refreshList,
  onSuccess,
}: {
  modalState: boolean;
  setModalState: (state: boolean) => void;
  title?: string;
  existing?: PresentationInterface;
  refreshList?: () => void;
  onSuccess?: () => void;
}): React.ReactElement => {
  const { data, error } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>("/experiments");
  //const [expStatus, setExpStatus] = useState("stopped");
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { getUserDisplay } = useUser();
  const form = useForm<Partial<PresentationInterface>>({
    defaultValues: {
      title: existing?.title || "A/B Test Review",
      description: existing?.description || date(new Date()),
      theme: existing?.theme || defaultTheme,
      customTheme: existing?.customTheme || {
        backgroundColor: "#3400a3",
        textColor: "#ffffff",
        headingFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        bodyFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      },
      slides: existing?.slides || [],
      sharable: existing?.sharable || true,
    },
  });

  useEffect(() => {
    if (existing?.slides) {
      const newVal = {
        ...form.getValues(),
        title: existing?.title || "A/B Test Review",
        description: existing?.description || date(new Date()),
        theme: existing?.theme || defaultTheme,
        customTheme: existing?.customTheme || {
          backgroundColor: "#3400a3",
          textColor: "#ffffff",
          headingFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          bodyFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        },
        slides: existing?.slides || [],
        sharable: existing?.sharable || true,
      };
      form.reset(newVal);
    }
  }, [existing?.slides]);

  const { items: experiments, searchInputProps, isFiltered } = useSearch({
    items: data?.experiments || [],
    defaultSortField: "id",
    localStorageKey: "experiments-share",
    searchFields: [
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
    ],
  });

  const { apiCall } = useAuth();

  const submitForm = form.handleSubmit(async (value) => {
    if (loading) return;
    setLoading(true);
    setSaveError(null);

    const l = { ...value };
    try {
      // paths for update or save new
      const postURL = existing?.id
        ? `/presentation/${existing.id}`
        : "/presentation";

      await apiCall<{ status: number; message?: string }>(postURL, {
        method: "POST",
        body: JSON.stringify(l),
      });

      if (existing?.id) {
        track("Presentation edited");
      } else {
        track("Presentation created");
      }
      if (onSuccess && typeof onSuccess === "function") onSuccess();
      setLoading(false);
      refreshList();
    } catch (e) {
      console.error(e);
      setSaveError(e.message);
      setLoading(false);
    }
  });

  if (!data) {
    // still loading...
    return null;
  }
  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (experiments.length === 0) {
    return (
      <div className="alert alert-danger">
        You need some experiments to share first.
      </div>
    );
  }

  const byId = new Map();
  const byStatus: {
    stopped: ExperimentInterfaceStringDates[];
    archived: ExperimentInterfaceStringDates[];
    //draft: ExperimentInterfaceStringDates[];
    running: ExperimentInterfaceStringDates[];
    //myDrafts: ExperimentInterfaceStringDates[];
  } = {
    stopped: [],
    archived: [],
    //draft: [],
    running: [],
    //myDrafts: [],
  };
  //const defaultGraph = "pill";

  // organize existing experiments by status
  experiments.forEach((test) => {
    if (test.archived) {
      byStatus.archived.push(test);
    } else if (test.status in byStatus) {
      byStatus[test.status].push(test);
    }
    byId.set(test.id, test);
  });

  const selectedExperiments = new Map();
  const value = {
    slides: form.watch("slides"),
    theme: form.watch("theme"),
    customTheme: form.watch("customTheme"),
    title: form.watch("title"),
    description: form.watch("description"),
  };
  value.slides.forEach((obj: PresentationSlide) => {
    selectedExperiments.set(obj.id, byId.get(obj.id));
  });

  const setSelectedExperiments = (exp: ExperimentInterfaceStringDates) => {
    if (selectedExperiments.has(exp.id)) {
      selectedExperiments.delete(exp.id);
    } else {
      selectedExperiments.set(exp.id, exp);
    }
    const exps = [];
    // once we add options, we'll have to make this merge in previous options per exp
    Array.from(selectedExperiments.keys()).forEach((e) => {
      exps.push({ id: e, type: "experiment" });
    });
    form.setValue("slides", exps);
  };

  const reorder = (slides, startIndex, endIndex) => {
    const result = [...slides];
    const [removed] = result.splice(startIndex, 1);
    result.splice(endIndex, 0, removed);
    return result;
  };

  const onDragEnd = (result) => {
    // dropped outside the list
    if (!result.destination) {
      return;
    }
    form.setValue(
      "slides",
      reorder(value.slides, result.source.index, result.destination.index)
    );
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

  Object.entries(byStatus).forEach(([status]) => {
    tabContents.push(
      <Tab
        key={status}
        display={
          status.charAt(0).toUpperCase() + status.substr(1).toLowerCase()
        }
        anchor={status}
        count={byStatus[status].length}
      >
        {byStatus[status].length > 0 ? (
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
                    getValidDate(
                      b.phases[b.phases.length - 1]?.dateEnded
                    ).getTime() -
                    getValidDate(
                      a.phases[a.phases.length - 1]?.dateEnded
                    ).getTime()
                )
                .map((e: ExperimentInterfaceStringDates) => {
                  const phase = e.phases[e.phases.length - 1];
                  if (!phase) return null;

                  let hasScreenShots = true;
                  e.variations.forEach((v) => {
                    if (v.screenshots.length < 1) {
                      hasScreenShots = false;
                    }
                  });
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
                            {e.name}
                            {hasScreenShots ? (
                              <></>
                            ) : (
                              <span className="text-warning pl-3">
                                <Tooltip body="This experiment is missing screen shots">
                                  <FiAlertTriangle />
                                </Tooltip>
                              </span>
                            )}
                          </h4>
                        </div>
                      </td>
                      <td className="nowrap">
                        <SortedTags tags={Object.values(e.tags)} />
                      </td>
                      <td className="nowrap">
                        {getUserDisplay(e.owner, false)}
                      </td>
                      <td className="nowrap" title={datetime(phase.dateEnded)}>
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
            No {isFiltered ? "matching" : ""} {status} experiments
          </div>
        )}
      </Tab>
    );
    // end of the byStatus loop
  });

  // end tab contents

  let counter = 0;
  const selectedList = [];
  //const expOptionsList = [];

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
              <span className="drag-handle mr-2" {...provided.dragHandleProps}>
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
    // adding options for each experiment... disabled for now
    // expOptionsList.push(
    //   <div>
    //     {exp.name}
    //     <div className="row">
    //       <div className="col">
    //         <div className="form-group form-check">
    //           <label className="form-check-label">
    //             <input
    //               type="checkbox"
    //               className="form-check-input"
    //               checked={value.options[id]?.showScreenShots}
    //               onChange={(e) => {
    //                 const opt = { ...value.options };
    //                 opt[id].showScreenShots = e.target.checked;
    //                 const tmp = {
    //                   ...value,
    //                   options: opt,
    //                 };
    //                 manualUpdate(tmp);
    //               }}
    //               id="checkbox-showscreenshots"
    //             />
    //             Show screen shots (if avaliable)
    //           </label>
    //         </div>
    //         <div className="form-row form-inline">
    //           <div className="form-group">
    //             <label className="mr-3">Graph type</label>
    //             <select
    //               className="form-control"
    //               {...inputProps.options[id].graphType}
    //             >
    //               <option selected>{defaultGraph}</option>
    //               <option>violin</option>
    //             </select>
    //           </div>
    //         </div>
    //       </div>
    //     </div>
    //   </div>
    // );
  });

  const presThemes = [];
  for (const [key, value] of Object.entries(presentationThemes)) {
    if (value.show) {
      presThemes.push({
        value: key,
        label: value.title,
      });
    }
  }

  if (!modalState) {
    return null;
  }

  const fontOptions = [
    {
      value: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      label: "Helvetica Neue",
    },
    { value: "Arial", label: "Arial" },
    { value: "Impact", label: "Impact" },
    { value: '"Times New Roman", serif', label: "Times New Roman" },
    { value: "American Typewriter", label: "American Typewriter" },
    { value: "Courier, Monospace", label: "Courier" },
    { value: '"Comic Sans MS", "Comic Sans"', label: "Comic Sans" },
    { value: "Cursive", label: "Cursive" },
  ];

  return (
    <PagedModal
      header={title}
      close={() => setModalState(false)}
      submit={submitForm}
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
          <div className="col-sm-12 col-md-4 mb-5">
            <h4>Selected experiments to share</h4>
            <div className="selected-area h-100">
              <DragDropContext onDragEnd={onDragEnd}>
                <Droppable droppableId="droppable">
                  {(provided) => (
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
                          Choose experiments from the list
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
                  <Field
                    placeholder="Search..."
                    type="search"
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
      <Page display="Presentation Options">
        <div className="row new-share">
          <div className="col-sm-12 col-md-6">
            <div className="form-group row">
              <label
                htmlFor="inputtitle"
                className="col-sm-4 col-form-label text-right"
              >
                Title
              </label>
              <div className="col-sm-8">
                <input
                  type="text"
                  className="form-control"
                  id="inputtitle"
                  placeholder=""
                  {...form.register("title")}
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
                  type="text"
                  className="form-control"
                  id="inputdesc"
                  placeholder=""
                  {...form.register("description")}
                />
              </div>
            </div>
            {/* <div className="form-group row">
                <label className="form-check-label col-sm-4 col-form-label text-right">
                  Enable sharing
                </label>
                <div className="col-sm-8" style={{ verticalAlign: "middle" }}>
                  <input
                    type="checkbox"
                    className=""
                    checked={value.sharable}
                    onChange={(e) => {
                      manualUpdate({ ...value, sharable: e.target.checked });
                    }}
                    id="checkbox-voting"
                  />
                </div>
              </div> */}
            {/* <div className="form-group row">
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
                </div>*/}
            <div className="form-group row">
              <label htmlFor="" className="col-sm-4 col-form-label text-right">
                Presentation theme
              </label>
              <div className="col-sm-8">
                <SelectField
                  value={form.watch("theme")}
                  onChange={(v) => form.setValue("theme", v)}
                  options={presThemes}
                />
              </div>
            </div>
            {value.theme === "custom" && (
              <>
                <div className="form-group row">
                  <label className="col-sm-4 col-form-label text-right">
                    Heading font
                  </label>
                  <div className="col-sm-12 col-md-8">
                    <SelectField
                      value={form.watch("customTheme.headingFont")}
                      onChange={(v) =>
                        form.setValue("customTheme.headingFont", v)
                      }
                      options={fontOptions}
                    />
                  </div>
                </div>
                <div className="form-group row">
                  <label className="col-sm-4 col-form-label text-right">
                    Body font
                  </label>
                  <div className="col-sm-12 col-md-8">
                    <SelectField
                      value={form.watch("customTheme.bodyFont")}
                      onChange={(v) => form.setValue("customTheme.bodyFont", v)}
                      options={fontOptions}
                    />
                  </div>
                </div>
                <div className="form-group row">
                  <div className="col text-center">
                    <label htmlFor="custombackground" className="text-center">
                      Background color
                    </label>
                    <HexColorPicker
                      onChange={(c) => {
                        form.setValue("customTheme.backgroundColor", c);
                      }}
                      style={{ margin: "0 auto" }}
                      color={value.customTheme?.backgroundColor || ""}
                      id="custombackground"
                    />
                  </div>
                  <div className="col text-center">
                    <label htmlFor="custombackground" className="text-center">
                      Text color
                    </label>
                    <HexColorPicker
                      onChange={(c) => {
                        form.setValue("customTheme.textColor", c);
                      }}
                      style={{ margin: "0 auto" }}
                      color={value.customTheme?.textColor || ""}
                      id="customtextcolor"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="col-sm-12 col-md-6" style={{ minHeight: "350px" }}>
            <h4>
              Preview{" "}
              <small className="text-muted">
                (use the arrow keys to change pages)
              </small>
            </h4>
            {value.slides.length > 0 ? (
              <>
                <div style={{ position: "absolute", left: "49%", top: "52%" }}>
                  <LoadingSpinner />
                </div>
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    maxHeight: "350px",
                    position: "relative",
                  }}
                >
                  <Preview
                    expIds={value.slides
                      .map((o) => {
                        return o.id;
                      })
                      .join(",")}
                    title={value.title}
                    desc={value.description}
                    theme={value.theme}
                    backgroundColor={value.customTheme.backgroundColor.replace(
                      "#",
                      ""
                    )}
                    textColor={value.customTheme.textColor.replace("#", "")}
                    headingFont={value.customTheme.headingFont}
                    bodyFont={value.customTheme.bodyFont}
                  />
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    maxHeight: "350px",
                    position: "relative",
                    lineHeight: "300px",
                    textAlign: "center",
                  }}
                >
                  Please select experiments from the previous page
                </div>
              </>
            )}
          </div>
        </div>
        {saveError}
      </Page>
    </PagedModal>
  );
};

export default ShareModal;

import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Box, Dialog, Flex, Grid, IconButton } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  PresentationInterface,
  PresentationSlide,
  PresentationThemeInterface,
  PresentationTransition,
  PresentationCelebration,
} from "shared/types/presentation";
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
import { getValidDate, ago, datetime, date } from "shared/dates";
import { PiArrowLeft, PiCaretRight, PiX } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import useOrgSettings from "@/hooks/useOrgSettings";
import { uploadFile } from "@/services/files";
import { getApiHost, hasUploadSupport } from "@/services/env";
import { useSearch } from "@/services/search";
import track from "@/services/track";
import { useExperiments } from "@/hooks/useExperiments";
import AuthorizedImage from "@/components/AuthorizedImage";
import ResultsIndicator from "@/components/Experiment/ResultsIndicator";
import Tooltip from "@/components/Tooltip/Tooltip";
import LoadingSpinner from "@/components/LoadingSpinner";
import SortedTags from "@/components/Tags/SortedTags";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Avatar from "@/ui/Avatar";
import { capitalizeFirstLetter } from "@/services/utils";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
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
  const { experiments: allExperiments } = useExperiments();
  //const [expStatus, setExpStatus] = useState("stopped");
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedSavedThemeId, setSelectedSavedThemeId] = useState<
    string | null
  >(null);
  const [saveThemeName, setSaveThemeName] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const { getUserDisplay, hasCommercialFeature } = useUser();
  const { blockFileUploads } = useOrgSettings();
  const hasPresentationStyling = hasCommercialFeature("presentation-styling");
  const canUploadLogo = hasUploadSupport() && !blockFileUploads;
  const { data: themesData, mutate: mutateThemes } = useApi<{
    status: number;
    themes: PresentationThemeInterface[];
  }>("/presentation-themes");
  const savedThemes = themesData?.themes ?? [];

  const form = useForm<Partial<PresentationInterface>>({
    defaultValues: {
      title: existing?.title || "A/B Test Review",
      description: existing?.description || date(new Date()),
      theme: existing?.theme || defaultTheme,
      transition: existing?.transition ?? "fade",
      celebration: existing?.celebration ?? "none",
      customTheme: existing?.customTheme || {
        backgroundColor: "#3400a3",
        textColor: "#ffffff",
        headingFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        bodyFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      },
      logoUrl: existing?.logoUrl,
      slides: existing?.slides || [],
      sharable: existing?.sharable ?? true,
    },
  });

  useEffect(() => {
    if (existing?.slides) {
      const newVal = {
        ...form.getValues(),
        title: existing?.title || "A/B Test Review",
        description: existing?.description || date(new Date()),
        theme: existing?.theme || defaultTheme,
        transition: existing?.transition ?? "fade",
        celebration: existing?.celebration ?? "none",
        customTheme: existing?.customTheme || {
          backgroundColor: "#3400a3",
          textColor: "#ffffff",
          headingFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          bodyFont: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        },
        logoUrl: existing?.logoUrl,
        slides: existing?.slides || [],
        sharable: existing?.sharable ?? true,
      };
      form.reset(newVal);
      setSelectedSavedThemeId(null);
    }
  }, [existing?.slides]);

  // When opening for edit, always start on the first step (Select Experiments)
  useEffect(() => {
    if (modalState && existing) {
      setStep(0);
    }
  }, [modalState, existing]);

  // Reset theme away from "custom" if user doesn't have presentation-styling
  useEffect(() => {
    if (!hasPresentationStyling && form.getValues("theme") === "custom") {
      form.setValue("theme", defaultTheme);
    }
  }, [hasPresentationStyling, existing?.theme]);

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

  const nextStep = step < 1 ? 1 : undefined;

  const handleStepSubmit = (e: React.FormEvent) => {
    if (nextStep !== undefined) {
      e.preventDefault();
      setStep(nextStep);
      return;
    }
    submitForm(e);
  };

  const {
    items: experiments,
    searchInputProps,
    isFiltered,
  } = useSearch({
    items: allExperiments || [],
    defaultSortField: "id",
    localStorageKey: "experiments-share",
    searchFields: [
      "name",
      "hypothesis",
      "description",
      "tags",
      "trackingKey",
      "status",
      "id",
      "owner",
      "goalMetrics",
      "secondaryMetrics",
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
    if (!hasPresentationStyling) {
      delete l.transition;
      delete l.celebration;
      delete l.logoUrl;
      if (l.theme === "custom") {
        l.theme = defaultTheme;
        delete l.customTheme;
      }
    }
    try {
      // Optionally save/update theme when custom and name is set
      if (
        hasPresentationStyling &&
        value.theme === "custom" &&
        saveThemeName.trim()
      ) {
        const name = saveThemeName.trim();
        const themeBody = {
          name,
          customTheme: form.getValues("customTheme"),
          transition: form.getValues("transition"),
          celebration: form.getValues("celebration"),
          logoUrl: form.getValues("logoUrl"),
        };
        if (selectedSavedThemeId) {
          await apiCall<{ status: number }>(
            `/presentation-theme/${selectedSavedThemeId}`,
            { method: "PUT", body: JSON.stringify(themeBody) },
          );
        } else {
          await apiCall<{ status: number; theme: PresentationThemeInterface }>(
            "/presentation-theme",
            { method: "POST", body: JSON.stringify(themeBody) },
          );
        }
        mutateThemes();
      }

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
      setLoading(false);
      if (onSuccess && typeof onSuccess === "function") onSuccess();
      refreshList?.();
      setModalState(false);
    } catch (e) {
      console.error(e);
      setSaveError(e.message);
      setLoading(false);
    }
  });

  if (experiments.length === 0) {
    return (
      <div className="alert alert-danger" style={{ marginTop: "1rem" }}>
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
    logoUrl: form.watch("logoUrl"),
    celebration: form.watch("celebration"),
    transition: form.watch("transition"),
  };
  value?.slides?.forEach((obj: PresentationSlide) => {
    selectedExperiments.set(obj.id, byId.get(obj.id));
  });

  // Ensure logo URL is loadable (API may return relative paths like /upload/xxx)
  const loadableLogoUrl = value.logoUrl?.startsWith("/")
    ? getApiHost() + value.logoUrl
    : value.logoUrl;

  const setSelectedExperiments = (exp: ExperimentInterfaceStringDates) => {
    if (selectedExperiments.has(exp.id)) {
      selectedExperiments.delete(exp.id);
    } else {
      selectedExperiments.set(exp.id, exp);
    }
    const exps: PresentationSlide[] = [];
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
      reorder(value.slides, result.source.index, result.destination.index),
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

  let counter = 0;
  const selectedList: JSX.Element[] = [];
  //const expOptionsList = [];

  selectedExperiments.forEach((exp: ExperimentInterfaceStringDates, id) => {
    const index = counter++;
    selectedList.push(
      <Draggable key={id} draggableId={id} index={index}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            className="shared-exp-div"
            style={getItemStyle(
              snapshot.isDragging,
              provided.draggableProps.style,
            )}
          >
            <Flex align="center" gap="3">
              <span className="drag-handle" {...provided.dragHandleProps}>
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
            </Flex>
          </div>
        )}
      </Draggable>,
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

  const presThemes: { value: string; label: string }[] = [];
  for (const [key, value] of Object.entries(presentationThemes)) {
    if (value.show && (hasPresentationStyling || key !== "custom")) {
      presThemes.push({
        value: key,
        label: value.title,
      });
    }
  }
  savedThemes.forEach((t) => {
    presThemes.push({ value: `saved:${t.id}`, label: t.name });
  });

  const handleThemeChange = (v: string) => {
    if (v.startsWith("saved:")) {
      const id = v.slice(6);
      const t = savedThemes.find((th) => th.id === id);
      if (t) {
        setSelectedSavedThemeId(t.id);
        setSaveThemeName(t.name);
        form.setValue("theme", "custom");
        form.setValue("customTheme", t.customTheme);
        form.setValue("transition", t.transition ?? "fade");
        form.setValue("celebration", t.celebration ?? "none");
        form.setValue("logoUrl", t.logoUrl ?? undefined);
      }
    } else {
      setSelectedSavedThemeId(null);
      setSaveThemeName("");
      form.setValue("theme", v);
      // Non-custom themes don't support celebration or logo—reset to defaults
      form.setValue("celebration", "none");
      form.setValue("logoUrl", undefined);
    }
  };

  const currentThemeValue = (() => {
    const theme = form.watch("theme");
    if (theme === "custom" && selectedSavedThemeId) {
      return `saved:${selectedSavedThemeId}`;
    }
    return theme ?? defaultTheme;
  })();

  if (!modalState) {
    return <></>;
  }

  return (
    <>
      <Dialog.Root
        open={modalState}
        onOpenChange={(open) => {
          if (!open) setModalState(false);
        }}
      >
        <Dialog.Content
          maxWidth="1400px"
          size="4"
          style={{ width: "95vw", overflow: "visible" }}
          aria-describedby={undefined}
        >
          <form onSubmit={handleStepSubmit}>
            <Flex direction="column" gap="4">
              <Flex justify="between" align="center">
                <Dialog.Title>{title}</Dialog.Title>
                <IconButton
                  variant="ghost"
                  color="gray"
                  size="3"
                  aria-label="Close"
                  onClick={() => setModalState(false)}
                >
                  <PiX />
                </IconButton>
              </Flex>
              <Tabs
                value={String(step)}
                onValueChange={(v) => setStep(Number(v))}
              >
                <TabsList>
                  <TabsTrigger value="0">Select Experiments</TabsTrigger>
                  <TabsTrigger value="1">Presentation Options</TabsTrigger>
                </TabsList>

                <Box pt="3" pb="4">
                  <TabsContent value="0">
                    <Grid
                      columns="auto 2fr"
                      rows="auto"
                      gap="4"
                      pt="3"
                      align="start"
                      className="new-share"
                    >
                      <Box className="selected-area" p="3">
                        <h4>Experiments to present</h4>
                        <Box
                          className="h-100 "
                          style={{ minWidth: "250px", maxWidth: "350px" }}
                        >
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
                        </Box>
                      </Box>
                      <Box className="w-100">
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
                            defaultValue={
                              byStatus.stopped.length > 0
                                ? "stopped"
                                : byStatus.running.length > 0
                                  ? "running"
                                  : undefined
                            }
                          >
                            <Box mb="3">
                              <TabsList>
                                {Object.keys(byStatus).map((status) => (
                                  <TabsTrigger key={status} value={status}>
                                    {capitalizeFirstLetter(status)}
                                    <Avatar
                                      color="gray"
                                      variant="soft"
                                      ml="2"
                                      size="sm"
                                    >
                                      {byStatus[status].length}
                                    </Avatar>
                                  </TabsTrigger>
                                ))}
                              </TabsList>
                            </Box>

                            {Object.keys(byStatus).map((status) => (
                              <TabsContent key={status} value={status}>
                                {byStatus[status].length > 0 ? (
                                  <Box className="w-100 scrolly">
                                    <table className="table table-hover experiment-table appbox">
                                      <thead>
                                        <tr>
                                          <th></th>
                                          <th style={{ width: "99%" }}>
                                            Experiment
                                          </th>
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
                                                b.phases[b.phases.length - 1]
                                                  ?.dateEnded,
                                              ).getTime() -
                                              getValidDate(
                                                a.phases[a.phases.length - 1]
                                                  ?.dateEnded,
                                              ).getTime(),
                                          )
                                          .map(
                                            (
                                              e: ExperimentInterfaceStringDates,
                                            ) => {
                                              const phase =
                                                e.phases[e.phases.length - 1];
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
                                                    selectedExperiments.has(
                                                      e.id,
                                                    )
                                                      ? "selected"
                                                      : ""
                                                  }`}
                                                >
                                                  <td>
                                                    <span className="h3 mb-0 checkmark">
                                                      <FaCheck />
                                                    </span>
                                                  </td>
                                                  <td>
                                                    <div className="d-flex">
                                                      <h4 className="testname h5 mb-0">
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
                                                    <SortedTags
                                                      tags={Object.values(
                                                        e.tags,
                                                      )}
                                                    />
                                                  </td>
                                                  <td className="nowrap">
                                                    {getUserDisplay(
                                                      e.owner,
                                                      false,
                                                    )}
                                                  </td>
                                                  <td
                                                    className="nowrap"
                                                    title={datetime(
                                                      phase?.dateEnded ?? "",
                                                    )}
                                                  >
                                                    {ago(
                                                      phase?.dateEnded ?? "",
                                                    )}
                                                  </td>
                                                  <td className="nowrap">
                                                    {e?.results ? (
                                                      <ResultsIndicator
                                                        results={
                                                          e?.results ?? null
                                                        }
                                                      />
                                                    ) : (
                                                      <span className="text-muted font-italic">
                                                        <Tooltip body="This experiment is has no results data">
                                                          no results
                                                        </Tooltip>
                                                      </span>
                                                    )}
                                                  </td>
                                                </tr>
                                              );
                                            },
                                          )}
                                      </tbody>
                                    </table>
                                  </Box>
                                ) : (
                                  <div className="alert alert-info">
                                    No {isFiltered ? "matching" : ""} {status}{" "}
                                    experiments
                                  </div>
                                )}
                              </TabsContent>
                            ))}
                          </Tabs>
                        </div>
                      </Box>
                    </Grid>
                  </TabsContent>
                  <TabsContent value="1">
                    <Flex gap="6" align="start" justify="between">
                      <Grid
                        columns="30% 70%"
                        rows="auto"
                        gap="4"
                        align="center"
                        width="50%"
                      >
                        <label htmlFor="inputtitle" className="text-right mb-0">
                          Title
                        </label>
                        <input
                          type="text"
                          className="form-control"
                          id="inputtitle"
                          placeholder=""
                          {...form.register("title")}
                        />
                        <label htmlFor="inputdesc" className="text-right mb-0">
                          Sub-title
                        </label>
                        <input
                          type="text"
                          className="form-control"
                          id="inputdesc"
                          placeholder=""
                          {...form.register("description")}
                        />
                        <label htmlFor="" className="text-right mb-0">
                          Presentation theme
                        </label>
                        <Box className="">
                          <SelectField
                            value={currentThemeValue}
                            onChange={handleThemeChange}
                            options={presThemes}
                          />
                          {hasPresentationStyling &&
                            value.theme !== "custom" && (
                              <div className="mt-2 d-flex gap-2 flex-wrap align-items-center">
                                <button
                                  type="button"
                                  className="btn btn-link btn-sm p-0"
                                  onClick={() => {
                                    setSelectedSavedThemeId(null);
                                    setSaveThemeName("");
                                    form.setValue("theme", "custom");
                                  }}
                                >
                                  New custom theme
                                </button>
                              </div>
                            )}
                        </Box>
                        {value.theme === "custom" && hasPresentationStyling && (
                          <>
                            {(canUploadLogo || value.logoUrl) && (
                              <>
                                <label
                                  htmlFor="presentation-logo-upload"
                                  className="text-right mb-0"
                                  style={{
                                    opacity: hasPresentationStyling ? 1 : 0.6,
                                    pointerEvents: hasPresentationStyling
                                      ? "auto"
                                      : "none",
                                  }}
                                >
                                  <Box>Company logo</Box>
                                  <Box className="small text-muted">
                                    (title slide)
                                  </Box>
                                </label>
                                <Box>
                                  {value.logoUrl ? (
                                    <Flex align="center" gap="2">
                                      <Box
                                        style={{
                                          backgroundColor: form.getValues(
                                            "customTheme.backgroundColor",
                                          ),
                                        }}
                                      >
                                        <AuthorizedImage
                                          src={loadableLogoUrl}
                                          alt="Logo"
                                          style={{
                                            maxHeight: 48,
                                            maxWidth: 120,
                                            objectFit: "contain",
                                          }}
                                        />
                                      </Box>
                                      <Button
                                        type="button"
                                        color="red"
                                        variant="soft"
                                        onClick={() =>
                                          form.setValue("logoUrl", undefined)
                                        }
                                      >
                                        Remove
                                      </Button>
                                    </Flex>
                                  ) : (
                                    <Flex direction="column" gap="2">
                                      <input
                                        type="file"
                                        accept="image/*"
                                        className="d-none"
                                        id="presentation-logo-upload"
                                        onChange={async (e) => {
                                          const file = e.target.files?.[0];
                                          if (!file) return;
                                          setLogoUploading(true);
                                          try {
                                            const { fileURL } =
                                              await uploadFile(apiCall, file);
                                            form.setValue("logoUrl", fileURL);
                                          } catch (err) {
                                            setSaveError(
                                              err?.message ?? "Upload failed",
                                            );
                                          } finally {
                                            setLogoUploading(false);
                                            e.target.value = "";
                                          }
                                        }}
                                      />
                                      <label
                                        htmlFor="presentation-logo-upload"
                                        className="btn btn-outline-primary btn-sm mb-0"
                                        style={{ cursor: "pointer" }}
                                      >
                                        {logoUploading
                                          ? "Uploading…"
                                          : "Upload logo"}
                                      </label>
                                    </Flex>
                                  )}
                                </Box>
                              </>
                            )}
                            <label className="text-right mb-0">
                              <Box>Celebration</Box>
                              <Box className="small text-muted">
                                (winning experiments)
                              </Box>
                            </label>
                            <Box>
                              <SelectField
                                value={form.watch("celebration") ?? "none"}
                                onChange={(v) =>
                                  form.setValue(
                                    "celebration",
                                    v as PresentationCelebration,
                                  )
                                }
                                options={[
                                  { value: "none", label: "None" },
                                  {
                                    value: "confetti",
                                    label: "Confetti",
                                  },
                                  {
                                    value: "emoji",
                                    label: "Emoji confetti",
                                  },
                                  { value: "stars", label: "Stars" },
                                  { value: "random", label: "Random" },
                                  { value: "cash", label: "Cash" },
                                ]}
                                disabled={!hasPresentationStyling}
                              />
                            </Box>
                          </>
                        )}
                        {value.theme === "custom" && hasPresentationStyling && (
                          <>
                            <label className="text-right mb-0">
                              Slide transition
                            </label>
                            <Box>
                              <SelectField
                                value={form.watch("transition") ?? "fade"}
                                onChange={(v) =>
                                  form.setValue(
                                    "transition",
                                    v as PresentationTransition,
                                  )
                                }
                                options={[
                                  { value: "none", label: "None" },
                                  { value: "fade", label: "Fade" },
                                  { value: "slide", label: "Slide" },
                                ]}
                              />
                            </Box>
                            <label className="text-right mb-0">
                              Heading font
                            </label>
                            <Box>
                              <SelectField
                                value={form.watch("customTheme.headingFont")}
                                onChange={(v) =>
                                  form.setValue("customTheme.headingFont", v)
                                }
                                options={fontOptions}
                              />
                            </Box>
                            <label className="text-right mb-0">Body font</label>
                            <Box>
                              <SelectField
                                value={form.watch("customTheme.bodyFont")}
                                onChange={(v) =>
                                  form.setValue("customTheme.bodyFont", v)
                                }
                                options={fontOptions}
                              />
                            </Box>
                            <Box />
                            <Grid columns="1fr 1fr" gap="4">
                              <Flex direction="column" align="center" gap="2">
                                <label
                                  htmlFor="custombackground"
                                  className="text-center"
                                >
                                  Background color
                                </label>
                                <HexColorPicker
                                  onChange={(c) => {
                                    form.setValue(
                                      "customTheme.backgroundColor",
                                      c,
                                    );
                                  }}
                                  style={{ margin: "0 auto" }}
                                  color={
                                    value.customTheme?.backgroundColor || ""
                                  }
                                  id="custombackground"
                                />
                              </Flex>
                              <Flex direction="column" align="center" gap="2">
                                <label
                                  htmlFor="customtextcolor"
                                  className="text-center"
                                >
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
                              </Flex>
                            </Grid>
                            <label
                              htmlFor="presentation-theme-name"
                              className="text-right mb-0"
                            >
                              Theme name
                            </label>
                            <Flex direction="column" gap="1">
                              <input
                                id="presentation-theme-name"
                                type="text"
                                className="form-control"
                                value={saveThemeName}
                                onChange={(e) =>
                                  setSaveThemeName(e.target.value)
                                }
                                placeholder="Optional: name to save this theme for your organization"
                              />
                              <span className="text-muted small">
                                Leave blank to use this theme only in this
                                presentation. Enter a name to save it for your
                                team.
                              </span>
                            </Flex>
                          </>
                        )}
                      </Grid>
                      <Box
                        style={{
                          minHeight: "350px",
                          width: "50%",
                          maxWidth: "50%",
                          minWidth: 0,
                          overflow: "hidden",
                          position: "sticky",
                          top: "1rem",
                          alignSelf: "start",
                        }}
                      >
                        <h4>
                          Preview{" "}
                          <small className="text-muted">
                            (use the arrow keys to change pages)
                          </small>
                        </h4>
                        {(value.slides?.length ?? 0) > 0 ? (
                          <>
                            <div
                              style={{
                                position: "absolute",
                                left: "49%",
                                top: "52%",
                              }}
                            >
                              <LoadingSpinner />
                            </div>
                            <div
                              style={{
                                width: "100%",
                                height: "350px",
                                minWidth: 0,
                                overflow: "hidden",
                                position: "relative",
                              }}
                            >
                              <Preview
                                expIds={
                                  value.slides?.map((o) => o.id).join(",") ?? ""
                                }
                                title={value.title ?? ""}
                                desc={value.description ?? ""}
                                theme={value.theme ?? ""}
                                backgroundColor={
                                  value.customTheme?.backgroundColor?.replace(
                                    "#",
                                    "",
                                  ) ?? ""
                                }
                                textColor={
                                  value.customTheme?.textColor?.replace(
                                    "#",
                                    "",
                                  ) ?? ""
                                }
                                headingFont={value.customTheme?.headingFont}
                                bodyFont={value.customTheme?.bodyFont}
                                logoUrl={loadableLogoUrl}
                                celebration={value.celebration ?? "none"}
                                transition={value.transition ?? "fade"}
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
                      </Box>
                    </Flex>
                  </TabsContent>
                </Box>
              </Tabs>
              {saveError && <Text size="medium">{saveError}</Text>}
              <Flex gap="3" justify="end" align="center">
                {step >= 1 ? (
                  <Button
                    type="button"
                    variant="soft"
                    color="gray"
                    onClick={() => setStep(0)}
                  >
                    <PiArrowLeft /> Back
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="soft"
                  color="gray"
                  onClick={() => setModalState(false)}
                >
                  Cancel
                </Button>
                {step < 1 ? (
                  <Button type="submit">
                    Next <PiCaretRight />
                  </Button>
                ) : (
                  <Button type="submit" disabled={loading}>
                    Save
                  </Button>
                )}
              </Flex>
            </Flex>
          </form>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
};

export default ShareModal;

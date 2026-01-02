import React, { FC, useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { useForm } from "react-hook-form";
import { BsGear } from "react-icons/bs";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import Switch from "@/ui/Switch";
import Modal from "@/components/Modal";
import MetricsSelector from "@/components/Experiment/MetricsSelector";
import Field from "@/components/Forms/Field";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Frame from "@/ui/Frame";
import NorthStarMetricDisplay from "./NorthStarMetricDisplay";

const NorthStar: FC<{
  experiments: ExperimentInterfaceStringDates[];
  title?: string;
  showTitle?: boolean;
  metrics?: string[];
  startDate?: Date;
  endDate?: Date;
  showEdit?: boolean;
}> = ({ experiments, metrics, title, showTitle = true, showEdit }) => {
  const { apiCall } = useAuth();

  const { refreshOrganization } = useUser();
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();

  const smoothByStorageKey = `northstar_metrics_smoothBy`;
  const [smoothBy, setSmoothBy] = useLocalStorage<"day" | "week">(
    smoothByStorageKey,
    "week",
  );
  const [selectedMetrics, setSelectedMetrics] = useState(metrics);
  const [titleToShow, setTitleToShow] = useState(title);

  const form = useForm<{
    title: string;
    window: string | number;
    metrics: string[];
  }>({
    defaultValues: {
      title: title || settings.northStar?.title || "",
      window: "",
      metrics: metrics || settings.northStar?.metricIds || [],
    },
  });

  useEffect(() => {
    if (settings.northStar?.metricIds && !metrics?.length) {
      setSelectedMetrics(settings.northStar?.metricIds);
      form.setValue("metrics", settings.northStar?.metricIds || []);
    }
    if (settings.northStar?.title && !title) {
      setTitleToShow(settings.northStar?.title);
      form.setValue("title", settings.northStar?.title || "");
    }
  }, [settings.northStar]);

  const [openNorthStarModal, setOpenNorthStarModal] = useState(false);

  const [northstarHoverDate, setNorthstarHoverDate] = useState<number | null>(
    null,
  );
  const onNorthstarHoverCallback = (ret: { d: number | null }) => {
    setNorthstarHoverDate(ret.d);
  };

  const nameMap = new Map<string, string>();
  experiments.forEach((e) => {
    nameMap.set(e.id, e.name);
  });

  const northStar = settings.northStar || null;
  const hasNorthStar = (selectedMetrics?.length || 0) > 0;

  return (
    <>
      {hasNorthStar && (
        <Frame className="position-relative">
          {showEdit && permissionsUtil.canManageNorthStarMetric() && (
            <a
              role="button"
              className="p-1"
              style={{
                position: "absolute",
                top: "10px",
                right: "10px",
                zIndex: 1,
              }}
              onClick={(e) => {
                e.preventDefault();
                setOpenNorthStarModal(true);
              }}
            >
              <BsGear size={16} />
            </a>
          )}
          <div className="row">
            <div className="col">
              {showTitle && (
                <h2>
                  {titleToShow
                    ? titleToShow
                    : `North Star Metric${
                        (selectedMetrics?.length || 0) > 1 ? "s" : ""
                      }`}
                </h2>
              )}
            </div>
            <div className="col" style={{ position: "relative" }}>
              {(selectedMetrics?.length || 0) > 0 && (
                <Flex
                  className="float-right"
                  style={{ position: "relative", top: 40 }}
                >
                  <label
                    className="small my-0 mr-2 text-right align-middle"
                    htmlFor="toggle-group-smooth-by"
                  >
                    Smoothing
                    <br />
                    (7 day trailing)
                  </label>
                  <Switch
                    size="3"
                    value={smoothBy === "week"}
                    onChange={() =>
                      setSmoothBy(smoothBy === "week" ? "day" : "week")
                    }
                    id="toggle-group-smooth-by"
                  />
                </Flex>
              )}
            </div>
          </div>
          {(selectedMetrics?.length || 0) > 0 &&
            selectedMetrics?.map((mid) => (
              <div key={mid}>
                <NorthStarMetricDisplay
                  metricId={mid}
                  window={northStar?.window}
                  smoothBy={smoothBy}
                  hoverDate={northstarHoverDate}
                  onHoverCallback={onNorthstarHoverCallback}
                />
              </div>
            ))}
        </Frame>
      )}
      {openNorthStarModal && (
        <Modal
          trackingEventModalType=""
          close={() => setOpenNorthStarModal(false)}
          overflowAuto={false}
          autoFocusSelector={""}
          submit={form.handleSubmit(async (value) => {
            const newSettings = { ...settings };
            if (!newSettings.northStar)
              newSettings.northStar = {
                metricIds: value.metrics,
                title: value.title,
              };
            else {
              newSettings.northStar.metricIds = value.metrics;
              newSettings.northStar.title = value.title;
            }
            await apiCall("/organization", {
              method: "PUT",
              body: JSON.stringify({
                settings: { northStar: newSettings.northStar },
              }),
            });
            await refreshOrganization();
            setOpenNorthStarModal(false);
          })}
          header={
            hasNorthStar
              ? "Edit North Star Metric(s)"
              : "Add North Star Metric(s)"
          }
          open={true}
        >
          <div className="form-group">
            <label>Metric(s)</label>
            <MetricsSelector
              selected={form.watch("metrics")}
              onChange={(metrics) => form.setValue("metrics", metrics)}
              includeFacts={true}
              includeGroups={false}
              excludeQuantiles={true}
              noManual={true}
            />
          </div>
          <Field label="Title" {...form.register("title")} />
          {/*<Field*/}
          {/*  label="Date window"*/}
          {/*  initialOption="90"*/}
          {/*  {...form.register("window")}*/}
          {/*  options={[*/}
          {/*    { value: "30", display: "30 days" },*/}
          {/*    { value: "60", display: "60 days" },*/}
          {/*    { value: "90", display: "90 days" },*/}
          {/*    { value: "182", display: "6 months" },*/}
          {/*    { value: "365", display: "1 year" },*/}
          {/*  ]}*/}
          {/*/>*/}
          {/*<Field*/}
          {/*  label="Resolution"*/}
          {/*  {...form.register("resolution")}*/}
          {/*  options={[*/}
          {/*    { value: "day", display: "day" },*/}
          {/*    { value: "week", display: "week" },*/}
          {/*  ]}*/}
          {/*/>*/}
        </Modal>
      )}
    </>
  );
};
export default NorthStar;

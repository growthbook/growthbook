import React, { FC, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { BsGear } from "react-icons/bs";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import Modal from "../Modal";
import MetricsSelector from "../Experiment/MetricsSelector";
import Field from "../Forms/Field";
import NorthStarMetricDisplay from "./NorthStarMetricDisplay";

const NorthStar: FC<{
  experiments: ExperimentInterfaceStringDates[];
}> = ({ experiments }) => {
  const { apiCall } = useAuth();

  const { permissions, refreshOrganization } = useUser();
  const settings = useOrgSettings();

  const form = useForm<{
    title: string;
    window: string | number;
    metrics: string[];
    resolution: string;
  }>({ defaultValues: { resolution: "week" } });

  useEffect(() => {
    if (settings.northStar?.metricIds) {
      form.setValue("metrics", settings.northStar?.metricIds || []);
      // form.setValue(
      //   "window",
      //   settings.northStar?.window || ""
      // );
      form.setValue("title", settings.northStar?.title || "");
    }
  }, [settings.northStar]);

  const [openNorthStarModal, setOpenNorthStarModal] = useState(false);

  const nameMap = new Map<string, string>();
  experiments.forEach((e) => {
    nameMap.set(e.id, e.name);
  });

  const northStar = settings.northStar || null;
  const hasNorthStar = northStar?.metricIds && northStar.metricIds.length > 0;

  return (
    <>
      {hasNorthStar && (
        <div
          className="list-group activity-box mb-3"
          style={{ position: "relative" }}
        >
          {permissions.manageNorthStarMetric && (
            <a
              className="cursor-pointer"
              style={{ position: "absolute", top: "10px", right: "10px" }}
              onClick={(e) => {
                e.preventDefault();
                setOpenNorthStarModal(true);
              }}
            >
              <BsGear />
            </a>
          )}
          <h2>
            {northStar?.title
              ? northStar.title
              : `North Star Metric${
                  northStar?.metricIds.length > 1 ? "s" : ""
                }`}
          </h2>
          {northStar?.metricIds.map((mid) => (
            <div key={mid}>
              <NorthStarMetricDisplay
                metricId={mid}
                window={northStar?.window}
                resolution={northStar?.resolution ?? "week"}
              />
            </div>
          ))}
        </div>
      )}
      {openNorthStarModal && (
        <Modal
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
                settings: newSettings,
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

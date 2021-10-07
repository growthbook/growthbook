import React, { FC, useContext, useEffect, useState } from "react";
import Modal from "../Modal";
import { useForm } from "react-hook-form";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../../components/LoadingOverlay";
import { AuditInterface } from "back-end/types/audit";
import { SettingsApiResponse } from "../../pages/settings/";
import MetricsSelector from "../Experiment/MetricsSelector";
import NorthStarMetricDisplay from "./NorthStarMetricDisplay";
import { useAuth } from "../../services/auth";
import { BsGear } from "react-icons/bs";
import Field from "../Forms/Field";
import { UserContext } from "../ProtectedPage";

const NorthStar: FC = () => {
  const { apiCall } = useAuth();
  const { data, error } = useApi<{
    events: AuditInterface[];
    experiments: { id: string; name: string }[];
  }>("/activity");

  const {
    data: orgData,
    error: orgError,
    mutate,
  } = useApi<SettingsApiResponse>(`/organization`);

  const form = useForm<{
    title: string;
    window: string | number;
    metrics: string[];
    resolution: string;
  }>({ defaultValues: { resolution: "week" } });

  useEffect(() => {
    if (orgData?.organization?.settings?.northStar?.metricIds) {
      form.setValue(
        "metrics",
        orgData?.organization?.settings?.northStar?.metricIds || []
      );
      // form.setValue(
      //   "window",
      //   orgData?.organization?.settings?.northStar?.window || ""
      // );
      form.setValue(
        "title",
        orgData?.organization?.settings?.northStar?.title || ""
      );
    }
  }, [orgData?.organization?.settings?.northStar]);

  const [openNorthStarModal, setOpenNorthStarModal] = useState(false);
  const { permissions } = useContext(UserContext);

  if (orgError) {
    return <div className="alert alert-danger">{orgError.message}</div>;
  }
  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data || !orgData) {
    return <LoadingOverlay />;
  }
  const nameMap = new Map<string, string>();
  data.experiments.forEach((e) => {
    nameMap.set(e.id, e.name);
  });

  const northStar = orgData?.organization?.settings?.northStar || null;
  const hasNorthStar = northStar?.metricIds && northStar.metricIds.length > 0;

  return (
    <>
      {hasNorthStar ? (
        <div
          className="list-group activity-box mb-4"
          style={{ position: "relative" }}
        >
          {permissions.organizationSettings && (
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
      ) : (
        <a
          className="cursor-pointer"
          style={{ position: "absolute", top: "-20px", right: "15px" }}
          onClick={(e) => {
            e.preventDefault();
            setOpenNorthStarModal(true);
          }}
        >
          <BsGear />
        </a>
      )}
      {openNorthStarModal && (
        <Modal
          close={() => setOpenNorthStarModal(false)}
          submit={form.handleSubmit(async (value) => {
            const settings = { ...orgData.organization.settings };
            if (!settings.northStar)
              settings.northStar = {
                //enabled: true,
                metricIds: value.metrics,
                title: value.title,
                //window: "" + value.window,
                //resolution: value.resolution,
              };
            else {
              //settings.northStar.enabled = true;
              settings.northStar.metricIds = value.metrics;
              settings.northStar.title = value.title;
              //settings.northStar.window = "" + value.window;
              //settings.northStar.resolution = value.resolution;
            }
            await apiCall("/organization", {
              method: "PUT",
              body: JSON.stringify({
                settings,
              }),
            });
            await mutate();
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

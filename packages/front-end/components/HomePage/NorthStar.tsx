import React, { FC, useEffect, useState } from "react";
import Modal from "../Modal";
import useForm from "../../hooks/useForm";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../../components/LoadingOverlay";
import { AuditInterface } from "back-end/types/audit";
import { SettingsApiResponse } from "../../pages/settings/";
import MetricsSelector from "../Experiment/MetricsSelector";
import NorthStarMetricDisplay from "./NorthStarMetricDisplay";
import { useAuth } from "../../services/auth";
import { BsGear } from "react-icons/bs";

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

  const [value, inputProps, manualUpdate] = useForm({
    title: "",
    metrics: [],
    window: "",
  });

  useEffect(() => {
    const tmp = { ...value };
    if (orgData?.organization?.settings?.northStar?.metricIds) {
      tmp.metrics = orgData?.organization?.settings?.northStar?.metricIds;
      manualUpdate(tmp);
    }
  }, [orgData?.organization?.settings?.northStar?.metricIds]);

  const [openNorthStarModal, setOpenNorthStarModal] = useState(false);

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
          className="list-group activity-box overflow-auto mb-4"
          style={{ position: "relative" }}
        >
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
          submit={async () => {
            const settings = { ...orgData.organization.settings };
            if (!settings.northStar)
              settings.northStar = {
                metricIds: value.metrics,
                title: value.title,
                window: value.window,
              };
            else {
              settings.northStar.metricIds = value.metrics;
              settings.northStar.title = value.title;
              settings.northStar.window = value.window;
            }
            await apiCall("/organization", {
              method: "PUT",
              body: JSON.stringify({
                settings,
              }),
            });
            await mutate();
            setOpenNorthStarModal(false);
          }}
          header={
            hasNorthStar
              ? "Edit North Star Metric(s)"
              : "Add North Star Metric(s)"
          }
          open={true}
        >
          <div className="form-group">
            <label>Metric</label>
            <MetricsSelector
              selected={value.metrics}
              onChange={(metrics) => {
                manualUpdate({ metrics });
              }}
            />
          </div>
          <div className="form-group">
            <label>Title to show</label>
            <input className="form-control" type="text" {...inputProps.title} />
          </div>
          <div className="form-group">
            <label>Date window</label>
            <select className="form-control" {...inputProps.window}>
              <option value="30">Last 30 days</option>
              <option value="60">Last 60 days</option>
              <option value="90">Last 90 days</option>
              <option value="182">6 months</option>
              <option value="365">1 year</option>
            </select>
          </div>
        </Modal>
      )}
    </>
  );
};
export default NorthStar;

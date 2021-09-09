import React, { FC, useState } from "react";
import Modal from "../Modal";
import useForm from "../../hooks/useForm";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../../components/LoadingOverlay";
import { AuditInterface } from "back-end/types/audit";
import MetricsSelector from "../Experiment/MetricsSelector";

const NorthStar: FC = () => {
  const { data, error } = useApi<{
    events: AuditInterface[];
    experiments: { id: string; name: string }[];
  }>("/activity");

  const {
    data: orgdata,
    error: orgerror,
    mutate,
  } = useApi<SettingsApiResponse>(`/organization`);

  const [value, inputProps, manualUpdate] = useForm({
    metrics: [],
  });

  const [addNorthStar, setAddNorthStar] = useState(false);

  const onSubmitNorthStar = async () => {
    await apiCall(`/user/name`, {
      method: "PUT",
      body: JSON.stringify(editUserValue),
    });
    update();
    setUserDropdownOpen(false);
  };

  if (orgerror) {
    return <div className="alert alert-danger">{orgerror.message}</div>;
  }
  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data || !orgdata) {
    return <LoadingOverlay />;
  }

  const nameMap = new Map<string, string>();
  data.experiments.forEach((e) => {
    nameMap.set(e.id, e.name);
  });

  console.log(orgdata);

  const northStarMetric =
    orgdata?.organization?.settings?.northStar?.metricIds || null;
  const hasNorthStar = northStarMetric ? true : false;

  console.log(hasNorthStar);

  if (!hasNorthStar) {
    return (
      <>
        {addNorthStar && (
          <Modal
            close={() => setAddNorthStar(false)}
            submit={onSubmitNorthStar}
            header="Add North Star Metric"
            open={true}
          >
            <div className="form-group">
              <label>Metric</label>
              <MetricsSelector
                selected={value.metrics}
                onChange={(metrics) => {
                  console.log(metrics);
                  manualUpdate({ metrics });
                }}
              />
            </div>
          </Modal>
        )}
        <div>
          <button
            onClick={() => {
              setAddNorthStar(true);
            }}
          >
            add north star metric
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      <div></div>
    </>
  );
};
export default NorthStar;

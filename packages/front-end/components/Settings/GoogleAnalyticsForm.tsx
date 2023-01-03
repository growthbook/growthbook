import { FC, ChangeEventHandler, useState } from "react";
import { GoogleAnalyticsParams } from "back-end/types/integrations/googleanalytics";
import { FaKey, FaCheck } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import LoadingOverlay from "../LoadingOverlay";

const GoogleAnalyticsForm: FC<{
  params: Partial<GoogleAnalyticsParams>;
  existing: boolean;
  error: boolean;
  onParamChange: ChangeEventHandler<HTMLInputElement>;
  setParams: (params: { [key: string]: string }) => void;
}> = ({ params, existing, onParamChange, error }) => {
  const [loading, setLoading] = useState(false);
  const { apiCall } = useAuth();

  const redirect = async () => {
    setLoading(true);
    try {
      const res = await apiCall<{ url: string }>(`/oauth/google`, {
        method: "POST",
      });
      window.location.href = res.url;
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  if (error || (!existing && !params.refreshToken)) {
    return (
      <div className="position-relative mb-5">
        {loading && <LoadingOverlay />}
        <div className="alert alert-info">
          If you are using <strong>Google Analytics 4</strong>, you must use a{" "}
          <strong>BigQuery</strong> data source instead (
          <a
            href="https://support.google.com/analytics/answer/9823238"
            target="_blank"
            rel="noreferrer"
          >
            instructions
          </a>
          ). Universal Analytics properties can connect below.
        </div>
        <button
          className="btn btn-success"
          onClick={(e) => {
            e.preventDefault();
            redirect();
          }}
        >
          <FaKey /> Authenticate with Google Analytics
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="row">
        {loading && <LoadingOverlay />}
        <div className="form-group col-auto">
          <label>View Id</label>
          <input
            type="text"
            className="form-control"
            name="viewId"
            required
            value={params.viewId || ""}
            onChange={onParamChange}
          />
        </div>
        {existing && (
          <div className="form-group col-auto mb-3">
            <div className="mb-2 text-success">
              <FaCheck /> Authenticated
            </div>
            <button
              className="btn btn-secondary"
              onClick={(e) => {
                e.preventDefault();
                redirect();
              }}
            >
              <FaKey /> Re-Authenticate
            </button>
          </div>
        )}
      </div>
      <div>
        <p>
          We use custom dimensions to pull experiment results. The value of the
          dimension must be in the format:{" "}
          <code>[experiment][delimiter][variation]</code>. For example,{" "}
          <code>button-colors:blue</code>.
        </p>
        <div className="row">
          <div className="form-group col-auto">
            <label>Custom Dimension Index</label>
            <input
              type="number"
              min="1"
              max="20"
              className="form-control"
              required
              name="customDimension"
              value={params.customDimension || ""}
              onChange={onParamChange}
            />
          </div>
          <div className="form-group col-auto">
            <label>Delimiter</label>
            <input
              type="text"
              className="form-control"
              name="delimiter"
              placeholder=":"
              value={params.delimiter || ""}
              onChange={onParamChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default GoogleAnalyticsForm;

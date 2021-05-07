import { FC, ChangeEventHandler, useState } from "react";
import { GoogleAnalyticsParams } from "back-end/types/integrations/googleanalytics";
import { FaKey, FaCheck } from "react-icons/fa";
import LoadingOverlay from "../LoadingOverlay";
import { useAuth } from "../../services/auth";

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
      <div className="form-group col-auto">
        <label>Custom Dimension</label>
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
  );
};

export default GoogleAnalyticsForm;

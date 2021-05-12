import { FC, useEffect, useState } from "react";
import LoadingOverlay from "../../components/LoadingOverlay";
import DataSourceForm from "../../components/Settings/DataSourceForm";
import { useRouter } from "next/router";
import { useDefinitions } from "../../services/DefinitionsContext";

const Google: FC = () => {
  const [code, setCode] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Get code from querystring
    const c = window.location.search.match(/code=([^&]+)/)[1];
    if (!c) {
      setError("Authentication failed");
    } else {
      setCode(c);
    }
  }, []);

  const router = useRouter();
  const { mutateDefinitions } = useDefinitions();

  if (!code) {
    return <LoadingOverlay />;
  }
  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }

  const redirectToSettings = () => {
    mutateDefinitions({});
    router.push("/settings/datasources");
  };

  return (
    <div className="p-3">
      <h3>Add Data Source</h3>
      <DataSourceForm
        existing={false}
        data={{
          type: "google_analytics",
          name: "",
          params: {
            customDimension: "",
            refreshToken: code,
            viewId: "",
          },
        }}
        onCancel={redirectToSettings}
        onSuccess={redirectToSettings}
      />
    </div>
  );
};

export default Google;

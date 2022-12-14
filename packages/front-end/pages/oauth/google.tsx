import { FC, useEffect, useState } from "react";
import { useRouter } from "next/router";
import LoadingOverlay from "@/components/LoadingOverlay";
import DataSourceForm from "@/components/Settings/DataSourceForm";
import { useDefinitions } from "@/services/DefinitionsContext";

const Google: FC = () => {
  const [code, setCode] = useState(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Get code from querystring
    const c = window.location.search.match(/code=([^&]+)/)?.[1];
    if (!c) {
      setError(new Error("Authentication failed"));
    } else {
      setCode(c);
    }
  }, []);

  const router = useRouter();
  const { mutateDefinitions } = useDefinitions();

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!code) {
    return <LoadingOverlay />;
  }

  const redirectToSettings = async () => {
    await mutateDefinitions({});
    await router.push("/datasources");
  };

  return (
    <div className="p-3">
      <h3>Add Data Source</h3>
      <DataSourceForm
        existing={false}
        source="google-oauth"
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

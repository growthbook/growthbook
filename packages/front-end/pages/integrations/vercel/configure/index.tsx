import { ApiKeyRow } from "back-end/types/vercel";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../services/auth";

interface ConfigResponse {
  status: number;
  apiKeyRowList: ApiKeyRow[];
}

export default function VercelPage() {
  const { apiCall } = useAuth();
  const [apiKeyRowList, setApiKeyRowList] = useState<ApiKeyRow[]>([]);

  useEffect(() => {
    async function getConfig() {
      try {
        const res = await apiCall<ConfigResponse>("/vercel/config", {
          method: "GET",
        });
        setApiKeyRowList(
          res.apiKeyRowList.sort((a, b) =>
            a.projectName.localeCompare(b.projectName)
          )
        );
      } catch (err) {
        console.error(err);
      }
    }
    getConfig();
  }, []);

  return (
    <div className="overflow-auto">
      <table className="table mb-3 appbox gbtable table-hover">
        <thead>
          <tr>
            <th>Vercel Project</th>
            <th>Name In Vercel</th>
            <th>Key</th>
            <th>Environment</th>
            <th>Vercel Environment</th>
            <th>Description</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {apiKeyRowList.map((keyRow, i) => (
            <tr key={`apiKeyRow${i}`}>
              <td>{keyRow.projectName}</td>
              <td>{keyRow.key}</td>
              <td>{keyRow.value}</td>
              <td>{keyRow.gbEnvironment}</td>
              <td>{keyRow.vercelEnvironment}</td>
              <td>{keyRow.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { ApiKeyRow } from "back-end/types/vercel";
import useApi from "@/hooks/useApi";

type ConfigResponse = {
  status: number;
  apiKeyRowList: ApiKeyRow[];
};

export default function VercelPage() {
  const { data } = useApi<ConfigResponse>("/vercel/config");

  return (
    <div className="overflow-auto">
      <table className="table mb-3 appbox gbtable table-hover">
        <thead>
          <tr>
            <th>Vercel Project</th>
            <th>Name In Vercel</th>
            <th>Key</th>
            <th>GB Environment</th>
            <th>Vercel Environments</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {data?.apiKeyRowList
            .sort((a, b) => a.projectName.localeCompare(b.projectName))
            .map((keyRow, i) => (
              <tr key={`apiKeyRow${i}`}>
                <td>{keyRow.projectName}</td>
                <td>{keyRow.key}</td>
                <td>{keyRow.value}</td>
                <td>{keyRow.gbEnvironment}</td>
                <td>{keyRow.target.join(", ")}</td>
                <td>{keyRow.description}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

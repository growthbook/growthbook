import { FeatureInterface } from "back-end/types/feature";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "../../services/auth";
import { ago, datetime } from "../../services/dates";
import Toggle from "../Forms/Toggle";
import ValueDisplay from "./ValueDisplay";

export interface Props {
  feature: FeatureInterface;
  // eslint-disable-next-line
  mutate: () => Promise<any>;
}

export default function FeatureRow({ feature, mutate }: Props) {
  const [toggling, setToggling] = useState(false);

  const { apiCall } = useAuth();
  async function updateEnvironments(environment: string, on: boolean) {
    if (toggling) return;
    let envs = [...feature.environments];
    if (on) {
      if (envs.includes(environment)) {
        return;
      }
      envs.push(environment);
    } else {
      if (!envs.includes(environment)) {
        return;
      }
      envs = envs.filter((e) => e !== environment);
    }
    setToggling(true);
    try {
      await apiCall(`/feature/${feature.id}`, {
        method: "PUT",
        body: JSON.stringify({
          environments: envs,
        }),
      });
      await mutate();
    } catch (e) {
      console.error(e);
    }
    setToggling(false);
  }

  return (
    <tr>
      <td>
        <Link href={`/features/${feature.id}`}>
          <a>{feature.id}</a>
        </Link>
      </td>
      <td className="position-relative">
        <Toggle
          id={feature.id + "__dev"}
          label="Dev"
          value={feature.environments?.includes("dev") ?? false}
          setValue={(on) => {
            updateEnvironments("dev", on);
          }}
        />
      </td>
      <td className="position-relative">
        <Toggle
          id={feature.id + "__production"}
          label="Production"
          value={feature.environments?.includes("production") ?? false}
          setValue={(on) => {
            updateEnvironments("production", on);
          }}
        />
      </td>
      <td>
        <ValueDisplay value={feature.defaultValue} type={feature.valueType} />
      </td>
      <td>{feature.rules?.length > 0 ? "yes" : "no"}</td>
      <td title={datetime(feature.dateUpdated)}>{ago(feature.dateUpdated)}</td>
    </tr>
  );
}

import { Environment } from "back-end/types/organization";
import useOrgSettings from "./useOrgSettings";

export function useEnvironments() {
  const { environments } = useOrgSettings();

  if (!environments || !environments.length) {
    return [
      {
        id: "dev",
        description: "",
        toggleOnList: true,
      },
      {
        id: "production",
        description: "",
        toggleOnList: true,
      },
    ];
  }

  return environments;
}

export function useEnvironment(env: string): null | Environment {
  const envs = useEnvironments();
  return envs.filter((e) => e.id === env)[0] || null;
}

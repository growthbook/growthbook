import clsx from "clsx";
import { PiFunnel } from "react-icons/pi";
import { Trans, useLingui } from "@lingui/react/macro";
import FieldIndicator from "@/ui/FieldIndicator";
import { useDefinitions } from "@/services/DefinitionsContext";

export default function AttributeScopeToggle({
  allProjects,
  setAllProjects,
  scopeProjects,
}: {
  allProjects: boolean;
  setAllProjects: (v: boolean) => void;
  scopeProjects?: string[] | null;
}) {
  const { t } = useLingui();
  const { getProjectById } = useDefinitions();

  const scopeNames = (scopeProjects ?? []).map(
    (id) => getProjectById(id)?.name || id,
  );
  const scopeLabel = allProjects
    ? t`All Projects`
    : scopeNames.join(", ") || t`the current project scope`;
  const label = allProjects
    ? t`Showing attributes for ${scopeLabel}`
    : scopeNames.length > 1
      ? t`Showing attributes for Projects: ${scopeLabel}`
      : t`Showing attributes for Project: ${scopeLabel}`;

  return (
    <FieldIndicator
      label={label}
      tooltip={
        allProjects ? (
          <Trans>
            Showing attributes for <strong>{scopeLabel}</strong>
          </Trans>
        ) : scopeNames.length > 1 ? (
          <Trans>
            Showing attributes for Projects: <strong>{scopeLabel}</strong>
          </Trans>
        ) : (
          <Trans>
            Showing attributes for Project: <strong>{scopeLabel}</strong>
          </Trans>
        )
      }
      onClick={() => setAllProjects(!allProjects)}
      className={clsx("gb-select__toggle", {
        "gb-select__toggle--on": !allProjects,
      })}
      aria-pressed={!allProjects}
    >
      <PiFunnel />
    </FieldIndicator>
  );
}

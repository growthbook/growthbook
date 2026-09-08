import { ReactNode, useState } from "react";
import { LinkedFeatureInfo } from "shared/types/experiment";
import {
  getAttributeScopeProjectIds,
  getExperimentAttributeScopes,
} from "shared/util";
import { useStrictAttributeProjectScoping } from "@/services/features";
import AttributeScopeToggle from "./AttributeScopeToggle";

// `enforcement` mirrors the back-end check (null when any linked feature is
// unscoped); `dropdown` is the stricter picker default where unscoped linked
// features contribute nothing — the toggle is the escape hatch.
export function getLinkedExperimentAttributeScopes(
  project: string | undefined,
  linkedFeatures: LinkedFeatureInfo[] | undefined,
): { enforcement: string[] | null; dropdown: string[] | null } {
  const linkedScopes = (linkedFeatures ?? []).map((f) =>
    f.attributeScopeProjects !== undefined
      ? f.attributeScopeProjects
      : getAttributeScopeProjectIds(f.feature),
  );
  return getExperimentAttributeScopes(project, linkedScopes);
}

// Shared opt-out chain for the experiment targeting surfaces. Under strict
// project scoping the opt-out is ignored and its toggle hidden — the pickers
// must not offer attributes the server rejects.
export function useAttributeScopePicker({
  project,
  scopeProjects,
  allProjects,
  setAllProjects,
}: {
  project: string | undefined;
  scopeProjects: string[] | null;
  allProjects: boolean | undefined;
  setAllProjects: (v: boolean) => void;
}): {
  strictScoping: boolean;
  allProjectsPicker: boolean;
  effectiveAttributeProjects: string[] | null;
  attributeScopeToggle: ReactNode | undefined;
} {
  const strictScoping = useStrictAttributeProjectScoping();
  const allProjectsPicker = !strictScoping && !!allProjects;
  const effectiveAttributeProjects = allProjectsPicker ? null : scopeProjects;
  const attributeScopeToggle =
    !strictScoping && project && scopeProjects !== null ? (
      <AttributeScopeToggle
        allProjects={allProjectsPicker}
        setAllProjects={setAllProjects}
        scopeProjects={scopeProjects}
      />
    ) : undefined;
  return {
    strictScoping,
    allProjectsPicker,
    effectiveAttributeProjects,
    attributeScopeToggle,
  };
}

// Variant for feature surfaces, which don't persist the preference — the
// opt-out lives as local state scoped to the modal.
export function useLocalAttributeScopePicker(
  project: string | undefined,
  scopeProjects: string[] | null,
): ReturnType<typeof useAttributeScopePicker> {
  const [allProjects, setAllProjects] = useState(false);
  return useAttributeScopePicker({
    project,
    scopeProjects,
    allProjects,
    setAllProjects,
  });
}

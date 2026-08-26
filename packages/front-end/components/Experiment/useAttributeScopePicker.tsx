import { ReactNode } from "react";
import { LinkedFeatureInfo } from "shared/types/experiment";
import {
  getAttributeScopeProjectIds,
  getExperimentAttributeScopes,
} from "shared/util";
import { useStrictAttributeProjectScoping } from "@/services/features";
import AttributeScopeToggle from "./AttributeScopeToggle";

// Attribute-scope unions for an experiment's pickers, before the opt-out is
// applied: the experiment's project plus every linked feature's targeting
// projects. `enforcement` mirrors the back-end check exactly — null (unscoped)
// when any linked feature targets all projects. `dropdown` is the stricter
// default the pickers filter by: unscoped linked features contribute nothing
// instead of widening the list to every attribute; the toggle is the escape
// hatch.
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

// The strict-scoping / opt-out / effective-filter / toggle chain shared by
// every experiment targeting surface. `scopeProjects` is the restricted
// attribute scope before the opt-out (null = unscoped); `allProjects` is the
// picker preference (a form value or the persisted experiment field). The
// opt-out is ignored (and its toggle hidden) when the org strictly enforces
// project scoping — the pickers must not offer attributes the server rejects.
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
    !strictScoping && project ? (
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

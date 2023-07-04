import { get } from "lodash";
import { Settings, ScopeDefinition, SettingsResolver } from "../types";

const scopeOrder: Array<keyof ScopeDefinition> = [
  "project",
  "datasource",
  "experiment",
  "metric",
  "report",
];

export default function genDefaultResolver(
  baseFieldName: keyof Settings,
  scopesToApply:
    | Partial<Record<keyof ScopeDefinition, boolean | string>>
    | undefined = {}
): SettingsResolver<Settings[keyof Settings]> {
  const filteredScopes = scopeOrder
    .filter((s) => scopesToApply?.[s])
    .map((s) => ({
      scope: s,
      fieldName:
        typeof scopesToApply?.[s] === "string"
          ? scopesToApply[s]
          : baseFieldName,
    }));
  return (ctx) => {
    const baseSetting = ctx.baseSettings[baseFieldName]?.value;
    return filteredScopes.reduce(
      (acc, { scope, fieldName }) => {
        const scopedValue = get(ctx.scopes, `${scope}.${fieldName}`);
        if (typeof scopedValue === "undefined") return acc;
        return {
          value: scopedValue,
          meta: {
            scopeApplied: scope,
            reason: `${scope}-level setting applied`,
          },
        };
      },
      {
        value: baseSetting,
        meta: {
          scopeApplied: "organization",
          reason: "org-level setting applied",
        },
      }
    );
  };
}

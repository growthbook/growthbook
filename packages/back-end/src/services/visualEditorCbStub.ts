import { ContextualBanditInterface } from "shared/validators";

export function toVisualEditorCbExperimentStub(
  cb: ContextualBanditInterface,
): {
  id: string;
  trackingKey: string;
  name: string;
  status: string;
  project: string;
  hashAttribute: string;
  hashVersion: 2;
  type: "contextual-bandit";
  variations: Array<{
    variationId: string;
    key: string;
    name: string;
    description: string;
  }>;
} {
  return {
    id: cb.id,
    trackingKey: cb.trackingKey,
    name: cb.name,
    status: cb.status,
    project: cb.project ?? "",
    hashAttribute: cb.hashAttribute,
    hashVersion: 2,
    type: "contextual-bandit",
    variations: cb.variations.map((v) => ({
      variationId: v.id,
      key: v.key,
      name: v.name,
      description: v.description ?? "",
    })),
  };
}

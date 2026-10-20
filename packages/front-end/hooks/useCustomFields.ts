import { useDefinitions } from "@/services/DefinitionsContext";

export function useCustomFields() {
  const { customFields } = useDefinitions();
  return customFields;
}

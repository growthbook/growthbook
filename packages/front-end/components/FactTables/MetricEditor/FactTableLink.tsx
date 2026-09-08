import { useDefinitions } from "@/services/DefinitionsContext";
import Link from "@/ui/Link";

export default function FactTableLink({ id }: { id?: string }) {
  const { getFactTableById } = useDefinitions();
  const factTable = getFactTableById(id || "");
  if (!factTable) {
    return (
      <em style={{ color: "var(--color-text-mid)" }}>Unknown fact table</em>
    );
  }
  return <Link href={`/fact-tables/${factTable.id}`}>{factTable.name}</Link>;
}

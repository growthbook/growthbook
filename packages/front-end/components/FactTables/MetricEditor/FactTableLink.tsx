import { useDefinitions } from "@/services/DefinitionsContext";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

export default function FactTableLink({ id }: { id?: string }) {
  const { getFactTableById } = useDefinitions();
  const factTable = getFactTableById(id || "");
  if (!factTable) {
    return (
      <Text color="text-mid" fontStyle="italic">
        Unknown fact table
      </Text>
    );
  }
  return <Link href={`/fact-tables/${factTable.id}`}>{factTable.name}</Link>;
}

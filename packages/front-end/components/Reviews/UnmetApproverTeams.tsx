import { Box } from "@radix-ui/themes";
import Text from "@/ui/Text";

// Each entry is one requirement satisfied by ANY of its teams, and every entry
// must be satisfied — so they read as a checklist rather than a run of sentences.
export default function UnmetApproverTeams({
  unmet,
}: {
  unmet: { id: string; name: string }[][];
}) {
  const describe = (teams: { id: string; name: string }[]) =>
    teams.map((t) => t.name).join(" or ");

  if (unmet.length === 1) {
    return <>Needs approval from {describe(unmet[0])}.</>;
  }
  return (
    <>
      <Text as="p" mb="1">
        Needs approval from each of:
      </Text>
      <Box asChild>
        <ul className="mb-0 pl-4">
          {unmet.map((teams) => (
            <li key={teams.map((t) => t.id).join(",")}>{describe(teams)}</li>
          ))}
        </ul>
      </Box>
    </>
  );
}

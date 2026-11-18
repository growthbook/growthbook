import { Flex, Separator } from "@radix-ui/themes";
import { PanelSection } from "@/components/DetailsPanel";
import Metadata from "@/ui/Metadata";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import ScrollArea from "@/ui/ScrollArea";

const MAX_HEIGHT_PX = 240;

export type PanelReferenceRow = {
  title: string;
  items: { id: string; label: string; href?: string }[];
};

// A details panel's list of what uses the entity, one row per kind; nothing
// while nothing does.
export default function ReferencesPanelSection({
  title,
  intro,
  rows,
}: {
  title: string;
  intro: string;
  rows: PanelReferenceRow[];
}) {
  const shown = rows.filter((row) => row.items.length > 0);
  const count = shown.reduce((sum, row) => sum + row.items.length, 0);
  if (!count) return null;

  return (
    <>
      <Separator size="4" />
      <PanelSection title={`${title} (${count})`}>
        <Text as="p" size="sm" color="text-low" mb="0">
          <em>{intro}</em>
        </Text>
        {/* Held short, so a long list doesn't push the rest of the panel down. */}
        <ScrollArea edgeCue="fade" style={{ maxHeight: MAX_HEIGHT_PX }}>
          <Flex direction="column" gap="3">
            {shown.map((row) => (
              <Metadata
                key={row.title}
                size="sm"
                stacked
                label={row.title}
                value={
                  <Flex direction="column" gap="1">
                    {row.items.map((item) => (
                      <Text key={item.id} size="sm">
                        {item.href ? (
                          <Link href={item.href}>{item.label}</Link>
                        ) : (
                          item.label
                        )}
                      </Text>
                    ))}
                  </Flex>
                }
              />
            ))}
          </Flex>
        </ScrollArea>
      </PanelSection>
    </>
  );
}

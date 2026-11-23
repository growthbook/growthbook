import { useState } from "react";
import { Flex, Separator } from "@radix-ui/themes";
import { PanelSection } from "@/components/DetailsPanel";
import Metadata from "@/ui/Metadata";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";
import ScrollArea from "@/ui/ScrollArea";
import LoadingSpinner from "@/components/LoadingSpinner";

const MAX_HEIGHT_PX = 240;
const ITEMS_SHOWN = 50;

export type PanelReferenceRow = {
  title: string;
  items: { id: string; label: string; href?: string }[];
};

export type PanelReferences = {
  rows: PanelReferenceRow[];
  loading: boolean;
  error: boolean;
};

export default function ReferencesPanelSection({
  title,
  intro,
  rows,
  loading = false,
  error = false,
  emptyText,
}: {
  title: string;
  intro: string;
  rows: PanelReferenceRow[];
  loading?: boolean;
  error?: boolean;
  // Without it, the section hides when nothing is referenced.
  emptyText?: string;
}) {
  const shown = rows.filter((row) => row.items.length > 0);
  const count = shown.reduce((sum, row) => sum + row.items.length, 0);
  if (!count && !loading && !error && emptyText === undefined) return null;

  return (
    <>
      <Separator size="4" />
      <PanelSection title={count ? `${title} (${count})` : title}>
        {count ? (
          <Text as="p" size="sm" color="text-low" mb="0">
            <em>{intro}</em>
          </Text>
        ) : loading ? (
          <Flex align="center" gap="2">
            <LoadingSpinner />
            <Text size="sm" color="text-low">
              Loading…
            </Text>
          </Flex>
        ) : error ? (
          <HelperText status="error">
            Couldn&apos;t load references. Try refreshing.
          </HelperText>
        ) : (
          <Text as="p" size="sm" color="text-low" mb="0">
            <em>{emptyText}</em>
          </Text>
        )}
        {count ? (
          <ScrollArea
            gutter
            edgeCue="fade"
            style={{ maxHeight: MAX_HEIGHT_PX }}
          >
            <Flex direction="column" gap="3">
              {shown.map((row) => (
                <Metadata
                  key={row.title}
                  size="sm"
                  stacked
                  label={row.title}
                  value={<ReferenceItems items={row.items} />}
                />
              ))}
            </Flex>
          </ScrollArea>
        ) : null}
      </PanelSection>
    </>
  );
}

function ReferenceItems({ items }: { items: PanelReferenceRow["items"] }) {
  const [showAll, setShowAll] = useState(false);
  const hidden = showAll ? 0 : Math.max(0, items.length - ITEMS_SHOWN);
  return (
    <Flex direction="column" gap="1">
      {items.slice(0, items.length - hidden).map((item) => (
        <Text key={item.id} size="sm">
          {item.href ? <Link href={item.href}>{item.label}</Link> : item.label}
        </Text>
      ))}
      {hidden > 0 ? (
        <Text size="sm">
          <Link onClick={() => setShowAll(true)}>Show {hidden} more</Link>
        </Text>
      ) : null}
    </Flex>
  );
}

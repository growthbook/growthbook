import { ReactNode, useMemo, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  PiChartLine,
  PiFlask,
  PiMagnifyingGlass,
  PiTable,
} from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getMetricLink, isFactMetricId } from "shared/experiments";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import ProjectBadges from "@/components/ProjectBadges";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";

type FactTableResource = {
  id: string;
  name: string;
  projects: string[];
};

type MetricResource = {
  id: string;
  name: string;
};

function matchesQuery(query: string, name: string, id: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    name.toLowerCase().includes(needle) || id.toLowerCase().includes(needle)
  );
}

function SectionIcon({ children }: { children: ReactNode }) {
  return (
    <Flex
      align="center"
      justify="center"
      flexShrink="0"
      style={{
        width: 28,
        height: 28,
        borderRadius: "var(--radius-2)",
        background: "var(--violet-a3)",
        color: "var(--violet-11)",
      }}
    >
      {children}
    </Flex>
  );
}

function ResourceSection({
  sectionId,
  title,
  icon,
  total,
  filterPlaceholder,
  viewAllHref,
  viewAllLabel,
  emptyText,
  loading,
  error,
  thirdColumn,
  rows,
}: {
  sectionId: string;
  title: string;
  icon: ReactNode;
  total: number;
  filterPlaceholder: string;
  viewAllHref: string;
  viewAllLabel: string;
  emptyText: string;
  loading?: boolean;
  error?: string;
  thirdColumn: string;
  rows: { id: string; name: string; href: string; detail: ReactNode }[];
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => rows.filter((row) => matchesQuery(query, row.name, row.id)),
    [query, rows],
  );

  return (
    <Frame id={sectionId} mb="0" style={{ scrollMarginTop: 80 }}>
      <Flex align="center" gap="3" wrap="wrap" mb="3">
        <Flex align="center" gap="2">
          <SectionIcon>{icon}</SectionIcon>
          <Heading as="h3" size="sm" mb="0">
            {title}
          </Heading>
          {!loading && !error ? (
            <Badge label={String(total)} color="gray" />
          ) : null}
        </Flex>
        <Flex align="center" gap="3" ml="auto" wrap="wrap">
          {total > 0 ? (
            <Box style={{ width: 220 }}>
              <TextField
                size="sm"
                type="search"
                placeholder={filterPlaceholder}
                aria-label={filterPlaceholder}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                prepend={<PiMagnifyingGlass />}
              />
            </Box>
          ) : null}
          <Link href={viewAllHref}>{viewAllLabel}</Link>
        </Flex>
      </Flex>

      {loading ? (
        <Text color="text-mid">Loading…</Text>
      ) : error ? (
        <Callout status="error">{error}</Callout>
      ) : total === 0 ? (
        <Text color="text-mid">{emptyText}</Text>
      ) : filtered.length === 0 ? (
        <Text as="div" color="text-mid">
          No matching results.{" "}
          <Button variant="ghost" size="sm" onClick={() => setQuery("")}>
            Clear search
          </Button>
        </Text>
      ) : (
        <Table
          variant="list"
          stickyHeader
          roundedCorners
          scrollX
          maxHeight={320}
        >
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Name</TableColumnHeader>
              <TableColumnHeader>ID</TableColumnHeader>
              <TableColumnHeader>{thirdColumn}</TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link href={row.href}>{row.name}</Link>
                </TableCell>
                <TableCell>
                  <Text size="sm" color="text-mid">
                    {row.id}
                  </Text>
                </TableCell>
                <TableCell>{row.detail}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Frame>
  );
}

export default function ConnectedResources({
  factTables,
  metrics,
  experiments,
  experimentsError,
}: {
  factTables: FactTableResource[];
  metrics: MetricResource[];
  experiments: ExperimentInterfaceStringDates[] | null;
  experimentsError?: string;
}) {
  const sections = [
    {
      id: "connected-fact-tables",
      label: "Fact Tables",
      count: factTables.length,
    },
    { id: "connected-metrics", label: "Metrics", count: metrics.length },
    {
      id: "connected-experiments",
      label: "Experiments",
      count: experimentsError ? undefined : experiments?.length,
    },
  ];

  return (
    <Flex direction="column" gap="3">
      <Flex align="center" gap="2" wrap="wrap">
        <Text size="sm" color="text-mid">
          Jump to
        </Text>
        {sections.map((section) => (
          <Button
            key={section.id}
            variant="outline"
            size="sm"
            onClick={() => {
              document.getElementById(section.id)?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            }}
          >
            {section.label}
            {section.count !== undefined ? (
              <Badge
                label={String(section.count)}
                color="gray"
                variant="soft"
                size="xs"
                radius="medium"
                ml="2"
              />
            ) : null}
          </Button>
        ))}
      </Flex>

      <ResourceSection
        sectionId="connected-fact-tables"
        title="Fact Tables"
        icon={<PiTable size={16} />}
        total={factTables.length}
        filterPlaceholder="Filter fact tables"
        viewAllHref="/fact-tables"
        viewAllLabel="Go to Fact Tables →"
        emptyText="No Fact Tables use this Data Source."
        thirdColumn="Projects"
        rows={factTables.map((factTable) => ({
          id: factTable.id,
          name: factTable.name,
          href: `/fact-tables/${factTable.id}`,
          detail: (
            <ProjectBadges
              resourceType="fact table"
              projectIds={
                factTable.projects.length ? factTable.projects : undefined
              }
              skipMargin
            />
          ),
        }))}
      />

      <ResourceSection
        sectionId="connected-metrics"
        title="Metrics"
        icon={<PiChartLine size={16} />}
        total={metrics.length}
        filterPlaceholder="Filter metrics"
        viewAllHref="/metrics"
        viewAllLabel="Go to Metrics →"
        emptyText="No metrics use this Data Source."
        thirdColumn="Type"
        rows={metrics.map((metric) => {
          const isFact = isFactMetricId(metric.id);
          return {
            id: metric.id,
            name: metric.name,
            href: getMetricLink(metric.id),
            detail: (
              <Badge
                label={isFact ? "Fact Metric" : "Legacy Metric"}
                color={isFact ? "blue" : "indigo"}
                radius="full"
              />
            ),
          };
        })}
      />

      <ResourceSection
        sectionId="connected-experiments"
        title="Experiments"
        icon={<PiFlask size={16} />}
        total={experiments?.length ?? 0}
        filterPlaceholder="Filter experiments"
        viewAllHref="/experiments"
        viewAllLabel="Go to Experiments →"
        emptyText="No experiments use this Data Source."
        loading={experiments === null && !experimentsError}
        error={experimentsError}
        thirdColumn="Status"
        rows={(experiments ?? []).map((experiment) => ({
          id: experiment.id,
          name: experiment.name,
          href: `/experiment/${experiment.id}`,
          detail: (
            <ExperimentStatusIndicator
              experimentData={experiment}
              labelFormat="status-only"
            />
          ),
        }))}
      />
    </Flex>
  );
}

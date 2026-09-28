import { ReactNode, useState } from "react";
import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
} from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { IconButton } from "@radix-ui/themes";
import { PiLink, PiPencilSimple } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import UrlRedirectModal from "@/components/Experiment/UrlRedirectModal";
import ImplementationHeading from "@/components/Experiment/ImplementationHeading";
import { SdkConnectionEnvironmentsPopover } from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import { useLinkedChangeAddGate } from "@/components/Experiment/LinkedChanges/AddLinkedChanges";
import {
  AddImplementationButton,
  CardHeaderDivider,
  ImplementationCard,
  ImplementationCardHeader,
  ImplementationSection,
  VariationCells,
} from "@/components/Experiment/TabbedPage/ImplementationCard";
import { DropdownMenuItem } from "@/ui/DropdownMenu";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import { redirectDestinationParts } from "./redirectDestination";

function RedirectDestination({ from, to }: { from: string; to: string }) {
  const parts = redirectDestinationParts(from, to);
  const shown: ReactNode = parts ? (
    <>
      {parts.elided ? "…" : null}
      {parts.kept}
      <b>{parts.changed}</b>
    </>
  ) : (
    to
  );
  return (
    <Link
      href={to}
      external
      color="dark"
      underline="none"
      title={to}
      style={{ overflowWrap: "anywhere" }}
    >
      {shown}
    </Link>
  );
}

type ShownVariation = ReturnType<typeof getLatestPhaseVariations>[number];

function RedirectCard({
  urlRedirect,
  experiment,
  variations,
  canEdit,
  mutate,
  environmentStates,
}: {
  urlRedirect: URLRedirectInterface;
  experiment: ExperimentInterfaceStringDates;
  variations: ShownVariation[];
  canEdit: boolean;
  mutate: () => void;
  environmentStates?: LinkedChangeEnvStates;
}) {
  const { apiCall } = useAuth();
  const [editing, setEditing] = useState(false);
  const origin = urlRedirect.urlPattern;

  return (
    <ImplementationCard>
      {editing ? (
        <UrlRedirectModal
          mode="edit"
          experiment={experiment}
          urlRedirect={urlRedirect}
          mutate={mutate}
          close={() => setEditing(false)}
          source="redirect-linked-changes"
        />
      ) : null}
      <ImplementationCardHeader
        icon={<PiLink />}
        title={
          <Link
            href={origin}
            external
            weight="medium"
            style={{ overflowWrap: "anywhere" }}
          >
            {origin}
          </Link>
        }
        actions={
          <>
            {environmentStates ? (
              <SdkConnectionEnvironmentsPopover
                environmentStates={environmentStates}
                kind="URL Redirect"
              />
            ) : null}
            {canEdit ? (
              <>
                <CardHeaderDivider />
                <Tooltip content="Edit URL redirect">
                  <IconButton
                    variant="ghost"
                    color="violet"
                    radius="medium"
                    size="1"
                    onClick={() => setEditing(true)}
                    aria-label="Edit URL redirect"
                  >
                    <PiPencilSimple size="14" />
                  </IconButton>
                </Tooltip>
              </>
            ) : null}
          </>
        }
        menuLabel={`${origin} actions`}
        menu={
          canEdit ? (
            <DropdownMenuItem
              color="red"
              confirmation={{
                confirmationTitle: "Remove URL redirect",
                cta: "Remove",
                getConfirmationContent: async () =>
                  `Users stop being redirected from ${origin}.`,
                submit: async () => {
                  await apiCall(`/url-redirects/${urlRedirect.id}`, {
                    method: "DELETE",
                  });
                  mutate();
                },
              }}
            >
              Remove from experiment
            </DropdownMenuItem>
          ) : null
        }
      />
      <VariationCells variations={variations}>
        {(v) => {
          const to = urlRedirect.destinationURLs.find(
            (d) => d.variation === v.id,
          )?.url;
          return to ? (
            <RedirectDestination from={origin} to={to} />
          ) : (
            <Text color="text-low">No redirect</Text>
          );
        }}
      </VariationCells>
    </ImplementationCard>
  );
}

/** The experiment's URL Redirects: a card each, a destination per variation. */
export default function UrlRedirectRows({
  experiment,
  variations,
  urlRedirects,
  canEdit,
  mutate,
  environmentStates,
  onAdd,
  addBlockedReason = null,
}: {
  experiment: ExperimentInterfaceStringDates;
  // As the variation cards above show them, staged edits included.
  variations: ShownVariation[];
  urlRedirects: URLRedirectInterface[];
  canEdit: boolean;
  mutate: () => void;
  environmentStates?: LinkedChangeEnvStates;
  onAdd: (() => void) | null;
  addBlockedReason?: string | null;
}) {
  const { unsupportedReason, commercialFeature } = useLinkedChangeAddGate(
    "urlredirect",
    experiment,
  );
  return (
    <ImplementationSection
      cols={Math.min(variations.length, 3)}
      heading={
        <ImplementationHeading inList>URL Redirects</ImplementationHeading>
      }
      add={
        onAdd ? (
          <AddImplementationButton
            label="Add URL redirect"
            onClick={onAdd}
            disabledReason={addBlockedReason ?? unsupportedReason}
            commercialFeature={commercialFeature}
          />
        ) : null
      }
    >
      {urlRedirects.map((r) => (
        <RedirectCard
          key={r.id}
          urlRedirect={r}
          experiment={experiment}
          variations={variations}
          canEdit={canEdit}
          mutate={mutate}
          environmentStates={environmentStates}
        />
      ))}
    </ImplementationSection>
  );
}

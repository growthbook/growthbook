import { ReactNode } from "react";
import {
  ExperimentInterfaceStringDates,
  LinkedChangeEnvStates,
} from "shared/types/experiment";
import { getLatestPhaseVariations } from "shared/experiments";
import { IconButton } from "@radix-ui/themes";
import { PiLink, PiPencilSimple } from "react-icons/pi";
import ImplementationHeading from "@/components/Experiment/ImplementationHeading";
import { SdkConnectionEnvironmentsPopover } from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import { useLinkedChangeAddGate } from "@/components/Experiment/LinkedChanges/AddLinkedChanges";
import {
  AddImplementationButton,
  CardHeaderDivider,
  ImplementationCard,
  ImplementationCardHeader,
  ImplementationSection,
  StagedChangeNote,
  VariationCells,
} from "@/components/Experiment/TabbedPage/ImplementationCard";
import { ShownRedirect } from "@/components/Experiment/TabbedPage/linkedChangesDraft";
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

const STAGED_NOTES = {
  added: "Added when you save.",
  edited: "Changed when you save.",
  removed: "Removed from this experiment when you save.",
};

function RedirectCard({
  redirect,
  variations,
  project,
  canEdit,
  lockedReason,
  environmentStates,
  onEdit,
  onRemove,
  onUndo,
}: {
  redirect: ShownRedirect;
  variations: ShownVariation[];
  project: string;
  canEdit: boolean;
  lockedReason: string | null;
  environmentStates?: LinkedChangeEnvStates;
  onEdit: () => void;
  onRemove: () => void;
  onUndo: () => void;
}) {
  const origin = redirect.urlPattern;
  const removed = redirect.staged === "removed";
  const editable = canEdit && !removed;

  return (
    <ImplementationCard>
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
                project={project}
              />
            ) : null}
            {editable ? (
              <>
                <CardHeaderDivider />
                <Tooltip content={lockedReason ?? "Edit URL redirect"}>
                  <IconButton
                    variant="ghost"
                    color="violet"
                    radius="medium"
                    size="1"
                    disabled={!!lockedReason}
                    onClick={onEdit}
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
          editable ? (
            <DropdownMenuItem
              color="red"
              disabled={!!lockedReason}
              onClick={onRemove}
            >
              <Tooltip
                content={lockedReason}
                side="left"
                enabled={!!lockedReason}
              >
                <span>Remove from experiment</span>
              </Tooltip>
            </DropdownMenuItem>
          ) : null
        }
      />
      {redirect.staged ? (
        <StagedChangeNote onUndo={onUndo} mb={removed ? "0" : "3"}>
          {STAGED_NOTES[redirect.staged]}
        </StagedChangeNote>
      ) : null}
      {removed ? null : (
        <VariationCells variations={variations}>
          {(v) => {
            const to = redirect.destinationURLs.find(
              (d) => d.variation === v.id,
            )?.url;
            return to ? (
              <RedirectDestination from={origin} to={to} />
            ) : (
              <Text color="text-low">No redirect</Text>
            );
          }}
        </VariationCells>
      )}
    </ImplementationCard>
  );
}

/** The experiment's URL Redirects: a card each, a destination per variation. */
export default function UrlRedirectRows({
  experiment,
  variations,
  urlRedirects,
  canEdit,
  lockedReason = null,
  environmentStates,
  onAdd,
  addBlockedReason = null,
  onEdit,
  onRemove,
  onUndo,
}: {
  experiment: ExperimentInterfaceStringDates;
  // As the variation cards above show them, staged edits included.
  variations: ShownVariation[];
  urlRedirects: ShownRedirect[];
  canEdit: boolean;
  // Why the edits it offers can't be made by this user.
  lockedReason?: string | null;
  environmentStates?: LinkedChangeEnvStates;
  onAdd: (() => void) | null;
  addBlockedReason?: string | null;
  onEdit: (redirect: ShownRedirect) => void;
  onRemove: (redirect: ShownRedirect) => void;
  onUndo: (redirect: ShownRedirect) => void;
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
          key={r.key}
          redirect={r}
          variations={variations}
          project={experiment.project ?? ""}
          canEdit={canEdit}
          lockedReason={lockedReason}
          environmentStates={environmentStates}
          onEdit={() => onEdit(r)}
          onRemove={() => onRemove(r)}
          onUndo={() => onUndo(r)}
        />
      ))}
    </ImplementationSection>
  );
}

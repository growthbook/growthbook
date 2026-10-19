import { LinkedChangeEnvStates } from "shared/types/experiment";
import { SdkConnectionEnvironmentsPopover } from "@/components/Experiment/LinkedChanges/EnvironmentStatesGrid";
import {
  ColumnCell,
  ColumnFooter,
  ColumnHeader,
  ColumnLayout,
  HeaderText,
  StagedNote,
} from "@/components/Experiment/TabbedPage/ImplementationColumn";
import { ShownRedirect } from "@/components/Experiment/TabbedPage/linkedChangesDraft";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/ui/DropdownMenu";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import {
  redirectDestinationParts,
  withoutProtocol,
} from "./redirectDestination";

function RedirectDestination({ from, to }: { from: string; to: string }) {
  const parts = redirectDestinationParts(from, to);
  const shown = parts ? (
    <>
      {parts.elided ? "…" : null}
      {parts.kept}
      {parts.changed}
    </>
  ) : (
    withoutProtocol(to)
  );
  return (
    <Tooltip content={to} enabled={!!parts?.elided}>
      <Link href={to} external style={{ overflowWrap: "anywhere" }}>
        {shown}
      </Link>
    </Tooltip>
  );
}

const STAGED_NOTES = {
  added: "Added when you save.",
  edited: "Changed when you save.",
  removed: "Removed from this experiment when you save.",
};

export default function UrlRedirectColumn({
  layout,
  redirect,
  project,
  canEdit,
  lockedReason = null,
  environmentStates,
  onEdit,
  onRemove,
  onUndo,
}: {
  layout: ColumnLayout;
  redirect: ShownRedirect;
  project: string;
  canEdit: boolean;
  lockedReason?: string | null;
  environmentStates?: LinkedChangeEnvStates;
  onEdit: () => void;
  onRemove: () => void;
  onUndo: () => void;
}) {
  const { variations, showingLive } = layout;
  const shown = showingLive ? redirect.stored : redirect;
  const origin = (shown ?? redirect).urlPattern;
  const editable = canEdit && !showingLive && redirect.staged !== "removed";
  const locked = (label: string) => (
    <Tooltip content={lockedReason} side="left" enabled={!!lockedReason}>
      <span>{label}</span>
    </Tooltip>
  );
  const menu = editable
    ? [
        <DropdownMenuItem key="edit" disabled={!!lockedReason} onClick={onEdit}>
          {locked("Edit URL redirect")}
        </DropdownMenuItem>,
        <DropdownMenuSeparator key="separator" />,
        <DropdownMenuItem
          key="remove"
          color="red"
          disabled={!!lockedReason}
          onClick={onRemove}
        >
          {locked("Remove from experiment")}
        </DropdownMenuItem>,
      ]
    : [];

  return (
    <>
      <ColumnHeader
        layout={layout}
        title={
          <>
            <HeaderText>Redirects</HeaderText>
            <Link href={origin} external weight="regular" truncate>
              {withoutProtocol(origin)}
            </Link>
            <HeaderText>to…</HeaderText>
          </>
        }
        menu={menu}
        menuLabel={`${origin} actions`}
      />
      {variations.map((v, i) => {
        const to = shown?.destinationURLs.find(
          (d) => d.variation === v.id,
        )?.url;
        return (
          <ColumnCell key={v.id} layout={layout} row={i} fieldLine>
            {!shown ? null : to ? (
              <RedirectDestination from={origin} to={to} />
            ) : (
              <Text color="text-low">No redirect</Text>
            )}
          </ColumnCell>
        );
      })}
      <ColumnFooter
        layout={layout}
        start={
          shown &&
          environmentStates &&
          Object.keys(environmentStates).length ? (
            <SdkConnectionEnvironmentsPopover
              environmentStates={environmentStates}
              kind="URL Redirect"
              project={project}
            />
          ) : null
        }
      >
        {!shown ? (
          <Text size="sm" color="text-low">
            Not saved yet.
          </Text>
        ) : redirect.staged && !showingLive ? (
          <StagedNote onUndo={onUndo}>
            {STAGED_NOTES[redirect.staged]}
          </StagedNote>
        ) : null}
      </ColumnFooter>
    </>
  );
}

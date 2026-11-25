import { LinkedChangeEnvStates } from "shared/types/experiment";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
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
  const shown = parts
    ? `${parts.elided ? "…" : ""}${parts.path}`
    : withoutProtocol(to);
  return (
    <Tooltip content={to} enabled={!!parts?.elided}>
      <Link href={to} external style={{ overflowWrap: "anywhere" }}>
        {shown}
      </Link>
    </Tooltip>
  );
}

const STAGED_NOTES = {
  added: msg`Added when you save.`,
  edited: msg`Changed when you save.`,
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
  const { t, i18n } = useLingui();
  const { variations } = layout;
  const origin = redirect.urlPattern;
  const menu = canEdit
    ? [
        <DropdownMenuItem
          key="edit"
          disabled={!!lockedReason}
          tooltip={lockedReason ?? undefined}
          onClick={onEdit}
        >
          <Trans>Edit URL redirect</Trans>
        </DropdownMenuItem>,
        <DropdownMenuSeparator key="separator" />,
        <DropdownMenuItem
          key="remove"
          color="red"
          disabled={!!lockedReason}
          tooltip={lockedReason ?? undefined}
          onClick={onRemove}
        >
          <Trans>Remove from experiment</Trans>
        </DropdownMenuItem>,
      ]
    : [];

  return (
    <>
      <ColumnHeader
        layout={layout}
        title={
          <>
            <HeaderText>
              <Trans>Redirects</Trans>
            </HeaderText>
            <Link href={origin} external weight="regular" truncate>
              {withoutProtocol(origin)}
            </Link>
            <HeaderText>
              <Trans>to…</Trans>
            </HeaderText>
          </>
        }
        menu={menu}
        menuLabel={t`${origin} actions`}
      />
      {variations.map((v, i) => {
        const to = redirect.destinationURLs.find(
          (d) => d.variation === v.id,
        )?.url;
        return (
          <ColumnCell key={v.id} layout={layout} row={i} fieldLine>
            {to ? (
              <RedirectDestination from={origin} to={to} />
            ) : (
              <Text color="text-low">
                <Trans>No redirect</Trans>
              </Text>
            )}
          </ColumnCell>
        );
      })}
      <ColumnFooter
        layout={layout}
        start={
          environmentStates && Object.keys(environmentStates).length ? (
            <SdkConnectionEnvironmentsPopover
              environmentStates={environmentStates}
              kind="URL Redirect"
              project={project}
            />
          ) : null
        }
      >
        {redirect.staged ? (
          <StagedNote onUndo={onUndo}>
            {i18n._(STAGED_NOTES[redirect.staged])}
          </StagedNote>
        ) : null}
      </ColumnFooter>
    </>
  );
}

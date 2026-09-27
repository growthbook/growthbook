import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Flex } from "@radix-ui/themes";
import type { ManagedFlagKeyCheck } from "shared/util";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import type { FeatureInterface, ImplementationType } from "shared/validators";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { getEnabledEnvironments, useEnvironments } from "@/services/features";
import { useRegisterExperimentEdit } from "@/components/Experiment/TabbedPage/ExperimentEdits";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { TextField } from "@/ui/TextField";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import Text from "@/ui/Text";

interface ManagedFlagRenameValue {
  /** The id the flag carries once the page saves. */
  featureId: string;
  staged: boolean;
  /** Opens the rename dialog; null when the flag can't be renamed here. */
  edit: (() => void) | null;
}

const ManagedFlagRenameContext = createContext<
  (ManagedFlagRenameValue & { storedId: string }) | null
>(null);

/** The managed flag's id with any rename staged for the page's Save. */
export function useManagedFlagRename(
  featureId: string,
): ManagedFlagRenameValue {
  const ctx = useContext(ManagedFlagRenameContext);
  return ctx?.storedId === featureId
    ? ctx
    : { featureId, staged: false, edit: null };
}

/**
 * Stages a new id for the experiment's managed flag. Only a draft's flag can
 * be renamed: once it serves, code depends on the key.
 */
export function ManagedFlagRenameProvider({
  experiment,
  feature,
  stagedType,
  canEdit,
  children,
}: {
  experiment: ExperimentInterfaceStringDates;
  feature: FeatureInterface | null;
  /** A staged implementation type; leaving Values releases the flag. */
  stagedType: ImplementationType | null;
  canEdit: boolean;
  children: ReactNode;
}) {
  const permissionsUtil = usePermissionsUtil();
  const allEnvironments = useEnvironments();
  const [staged, setStaged] = useState<string | null>(null);
  // Saved, but shown until the page reloads the flag under its new id.
  const [landedId, setLandedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const storedId = feature?.id ?? null;
  const released = !!stagedType && stagedType !== "values";

  useEffect(() => {
    setStaged(null);
    setLandedId(null);
  }, [storedId]);
  useEffect(() => {
    if (released) setStaged(null);
  }, [released]);

  useRegisterExperimentEdit("managedFlagId", !!staged && staged !== landedId, {
    changes: () => (staged ? { renameManagedFlag: { to: staged } } : {}),
    onSaved: () => setLandedId(staged),
    discard: () => setStaged(null),
  });

  const value = useMemo(() => {
    if (!feature) return null;
    // The server takes the old key out of service and creates the new one.
    const envs = getEnabledEnvironments(feature, allEnvironments);
    const renamable =
      canEdit &&
      !released &&
      experiment.status === "draft" &&
      !experiment.archived &&
      permissionsUtil.canDeleteFeature(feature, envs) &&
      permissionsUtil.canCreateFeature(feature, envs);
    return {
      storedId: feature.id,
      featureId: staged ?? feature.id,
      staged: !!staged,
      edit: renamable ? () => setOpen(true) : null,
    };
  }, [
    feature,
    allEnvironments,
    canEdit,
    released,
    experiment.status,
    experiment.archived,
    permissionsUtil,
    staged,
  ]);

  if (!value || !feature) return <>{children}</>;
  return (
    <ManagedFlagRenameContext.Provider value={value}>
      {children}
      {open ? (
        <RenameManagedFlagModal
          experimentId={experiment.id}
          featureId={feature.id}
          staged={staged}
          stage={setStaged}
          close={() => setOpen(false)}
        />
      ) : null}
    </ManagedFlagRenameContext.Provider>
  );
}

function RenameManagedFlagModal({
  experimentId,
  featureId,
  staged,
  stage,
  close,
}: {
  experimentId: string;
  featureId: string;
  staged: string | null;
  stage: (to: string | null) => void;
  close: () => void;
}) {
  const { apiCall } = useAuth();
  const [key, setKey] = useState(staged ?? featureId);
  const [check, setCheck] = useState<ManagedFlagKeyCheck | null>(null);
  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const trimmed = key.trim();

  useEffect(() => {
    let cancelled = false;
    setCheckError(null);
    const timer = setTimeout(() => {
      apiCall<ManagedFlagKeyCheck>(
        `/experiment/${experimentId}/managed-flag/key-check?key=${encodeURIComponent(trimmed)}`,
      )
        .then((result) => {
          if (cancelled) return;
          setCheck(result);
          setCheckedKey(trimmed);
          setCheckError(null);
        })
        .catch((e) => {
          if (!cancelled) setCheckError(e.message || "Could not check the key");
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [apiCall, experimentId, trimmed]);

  const unchanged = trimmed === featureId;
  const current = checkedKey === trimmed ? check : null;
  const blocker = unchanged ? null : current?.blocker;
  const stateBlocker = check?.stateBlocker ?? null;
  const derivedId = check?.derivedId;
  const derivedIdBlocker =
    check?.derivedIdBlocker?.reason === "state"
      ? null
      : check?.derivedIdBlocker;
  const offerDerived =
    !!derivedId &&
    derivedId !== featureId &&
    derivedId !== trimmed &&
    !check?.derivedIdBlocker;

  return (
    <ModalStandard
      open={true}
      close={close}
      trackingEventModalType="rename-managed-flag"
      header="Rename Feature Flag"
      // Blocked from renaming now, a staged rename can still be dropped.
      cta={stateBlocker && staged ? "Keep current key" : "Apply"}
      ctaEnabled={
        stateBlocker
          ? !!staged
          : !!trimmed &&
            trimmed !== (staged ?? featureId) &&
            (unchanged || (!!current && !blocker))
      }
      submit={async () => stage(stateBlocker || unchanged ? null : trimmed)}
    >
      <Flex direction="column" gap="3">
        <Text as="p" color="text-mid">
          Your code reads this Feature Flag by its key. References stored in
          GrowthBook move to the new key; code that still uses the old key stops
          receiving the flag.
        </Text>
        {stateBlocker ? (
          <Callout status="warning" size="sm">
            {stateBlocker.message}
          </Callout>
        ) : null}
        <TextField
          label="Feature Flag key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          error={blocker?.message ?? checkError ?? undefined}
          disabled={!!stateBlocker}
          autoFocus
        />
        {derivedIdBlocker ? (
          <Callout status="info" size="sm">
            This Feature Flag can&apos;t use <strong>{check?.derivedId}</strong>
            , the key the experiment key derives. {derivedIdBlocker.message}
          </Callout>
        ) : null}
        {offerDerived ? (
          <Flex>
            <Button variant="ghost" size="sm" onClick={() => setKey(derivedId)}>
              Use {derivedId}
            </Button>
          </Flex>
        ) : null}
      </Flex>
    </ModalStandard>
  );
}

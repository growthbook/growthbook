import React, { FC, useEffect, useMemo, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Flex } from "@radix-ui/themes";
import { PiArrowClockwise, PiCaretDownFill } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { trackSnapshot } from "@/services/track";
import { useSnapshot } from "@/components/Experiment/SnapshotProvider";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import HelperText from "@/ui/HelperText";
import SplitButton from "@/ui/SplitButton";
import Text from "@/ui/Text";

const RefreshBanditButton: FC<{
  mutate: () => void;
  experiment: ExperimentInterfaceStringDates;
  setError: (e: string | undefined) => void;
  setGeneratedSnapshot: (s: ExperimentSnapshotInterface | undefined) => void;
  onLoadingChange: (loading: boolean) => void;
}> = ({
  mutate: mutateExperiment,
  experiment,
  setError: setOuterError,
  setGeneratedSnapshot: setOuterGeneratedSnapshot,
  onLoadingChange,
}) => {
  const { t } = useLingui();
  const [loading, setLoadingState] = useState(false);
  const setLoading = (next: boolean) => {
    setLoadingState(next);
    onLoadingChange(next);
  };
  const [_error, setError] = useState("");
  const [generatedSnapshot, setGeneratedSnapshot] = useState<
    ExperimentSnapshotInterface | undefined
  >(undefined);
  const [longResult, setLongResult] = useState(false);
  const [reweight, setReweight] = useState(false);

  const { setSnapshotType, mutate } = useSnapshot();

  const { getDatasourceById } = useDefinitions();

  const error = useMemo(() => {
    const trimErrorMessage = (message) => {
      const index = message.indexOf("\n\nTraceback");
      return index === -1 ? message : message.substring(0, index);
    };
    return trimErrorMessage(_error);
  }, [_error]);
  useEffect(() => {
    if (error) {
      setOuterError(error);
    }
  }, [error, setOuterError]);

  const { apiCall } = useAuth();

  const refresh = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let res: any = null;
    try {
      res = await apiCall<{
        status: number;
        message: string;
        snapshot: ExperimentSnapshotInterface;
      }>(
        `/experiment/${experiment.id}/banditSnapshot`,
        {
          method: "POST",
          body: JSON.stringify({
            reweight,
          }),
        },
        (responseData) => {
          res = responseData;
        },
      );
      trackSnapshot(
        "create",
        "RefreshBanditButton",
        getDatasourceById(experiment.datasource)?.type || null,
        res.snapshot,
      );
      await mutateExperiment();
    } catch (e) {
      console.error(e);
    }
    return res;
  };

  return (
    <Flex direction="column" align="end" gap="1">
      <Flex align="center" justify="end" gap="2">
        <Text size="sm" color="text-low">
          <Trans>Manually update and</Trans>
        </Text>
        <SplitButton
          variant="outline"
          menu={
            <DropdownMenu
              trigger={
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t`Update options`}
                >
                  <PiCaretDownFill />
                </Button>
              }
              menuPlacement="end"
              variant="soft"
            >
              <DropdownMenuItem onClick={() => setReweight(false)}>
                <Trans>Check results</Trans>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setReweight(true)}
                style={{ height: "auto" }}
              >
                <Flex direction="column" py="1">
                  <Text>
                    <Trans>Check results and update variation weights</Trans>
                  </Text>
                  {experiment.banditStage === "explore" && (
                    <HelperText status="warning" size="sm">
                      <Trans>Immediately begins the Exploit stage</Trans>
                    </HelperText>
                  )}
                </Flex>
              </DropdownMenuItem>
            </DropdownMenu>
          }
        >
          <Button
            variant="outline"
            size="sm"
            icon={<PiArrowClockwise />}
            setError={(e) => setError(e ?? "")}
            onClick={async () => {
              setLoading(true);
              setLongResult(false);

              const timer = setTimeout(() => {
                setLongResult(true);
              }, 5000);

              try {
                const res = await refresh();
                setGeneratedSnapshot(
                  res?.snapshot as ExperimentSnapshotInterface | undefined,
                );
                setOuterGeneratedSnapshot(
                  res?.snapshot as ExperimentSnapshotInterface | undefined,
                );
                const banditError = res?.snapshot?.banditResult?.error;
                if (res.status >= 400) {
                  setError(res.message || t`Unable to update bandit.`);
                } else if (banditError) {
                  setError(banditError);
                } else {
                  setError("");
                }
                setLoading(false);
                clearTimeout(timer);
              } catch (e) {
                setGeneratedSnapshot(undefined);
                setOuterGeneratedSnapshot(undefined);
                setLoading(false);
                clearTimeout(timer);
                throw e;
              }
              setSnapshotType("standard");
              // POSTing /banditSnapshot creates a new snapshot id; the
              // provider auto-upgrades the heavy fetch when status reports
              // the new successful id, so the default cheap mutate suffices.
              mutate();
            }}
          >
            {reweight ? t`Update weights` : t`Check results`}
          </Button>
        </SplitButton>
      </Flex>

      {loading && longResult ? (
        <Text size="sm" color="text-low">
          <Trans>This may take several minutes...</Trans>
        </Text>
      ) : null}
      {error ? (
        <HelperText status="error" size="sm">
          <Trans>Update errored</Trans>
        </HelperText>
      ) : generatedSnapshot ? (
        <HelperText status="success" size="sm">
          <Trans>Update successful</Trans>
        </HelperText>
      ) : null}
    </Flex>
  );
};

export default RefreshBanditButton;

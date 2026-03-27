import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { UserJourney, UserJourneyConfig } from "shared/validators";
import { QueryInterface } from "shared/types/query";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUserJourneyData } from "@/enterprise/components/ProductAnalytics/useUserJourneyData";
import { CacheOption } from "@/enterprise/components/ProductAnalytics/useExploreData";
import {
  cleanUserJourneyConfigForSubmission,
  compareUserJourneyConfig,
  isConfigSubmittable,
} from "./configUtils";

type SetDraftUserJourneyStateAction =
  | UserJourneyConfig
  | ((prevState: UserJourneyConfig) => UserJourneyConfig);

export interface UserJourneyContextValue {
  draftUserJourneyState: UserJourneyConfig;
  submittedUserJourneyState: UserJourneyConfig | null;
  userJourney: UserJourney | null;
  loading: boolean;
  error: string | null;
  query: QueryInterface | null;
  isStale: boolean;
  isSubmittable: boolean;
  needsFetch: boolean;
  needsUpdate: boolean;
  setDraftUserJourneyState: (action: SetDraftUserJourneyStateAction) => void;
  handleSubmit: (options?: { force?: boolean }) => Promise<void>;
  handleExtendPath: (
    pathToExtend: string[],
    stepToExtend: number,
  ) => Promise<void>;
}

const UserJourneyContext = createContext<UserJourneyContextValue | null>(null);

export function UserJourneyProvider({
  children,
  initialConfig,
  hasExistingResults = false,
}: {
  children: React.ReactNode;
  initialConfig: UserJourneyConfig;
  hasExistingResults?: boolean;
}) {
  const { loading, fetchData, extendPath } = useUserJourneyData();
  const { datasources } = useDefinitions();
  const [userJourneyState, setUserJourneyState] = useState<{
    draftState: UserJourneyConfig;
    submittedState: UserJourneyConfig | null;
    userJourney: UserJourney | null;
    error: string | null;
    query: QueryInterface | null;
  }>({
    draftState: initialConfig,
    submittedState: hasExistingResults ? initialConfig : null,
    userJourney: null,
    error: null,
    query: null,
  });
  const [isStale, setIsStale] = useState(false);
  const hasEverFetchedRef = useRef(false);

  const draftUserJourneyState = userJourneyState.draftState;
  const submittedUserJourneyState = userJourneyState.submittedState;

  const cleanedDraftUserJourneyState = useMemo(() => {
    return cleanUserJourneyConfigForSubmission(draftUserJourneyState);
  }, [draftUserJourneyState]);

  const cleanedSubmittedUserJourneyState = useMemo(() => {
    if (!submittedUserJourneyState) return null;
    return cleanUserJourneyConfigForSubmission(submittedUserJourneyState);
  }, [submittedUserJourneyState]);

  const { needsFetch, needsUpdate } = useMemo(() => {
    return compareUserJourneyConfig(
      cleanedSubmittedUserJourneyState,
      cleanedDraftUserJourneyState,
    );
  }, [cleanedSubmittedUserJourneyState, cleanedDraftUserJourneyState]);

  const isSubmittable = useMemo(() => {
    return isConfigSubmittable(cleanedDraftUserJourneyState);
  }, [cleanedDraftUserJourneyState]);

  const isManagedWarehouse = useMemo(() => {
    if (!draftUserJourneyState.datasource) return false;
    const datasource = datasources.find(
      (d) => d.id === draftUserJourneyState.datasource,
    );
    return datasource?.type === "growthbook_clickhouse";
  }, [datasources, draftUserJourneyState.datasource]);

  const setSubmittedUserJourneyState = useCallback(
    (state: UserJourneyConfig) => {
      setUserJourneyState((prev) => ({
        ...prev,
        submittedState: state,
      }));
    },
    [],
  );

  const doSubmit = useCallback(
    async (options?: { cache?: CacheOption }) => {
      if (!isSubmittable) return;

      let cache: CacheOption;
      if (options?.cache) {
        cache = options.cache;
      } else if (!hasEverFetchedRef.current || isManagedWarehouse) {
        cache = "preferred";
      } else {
        cache = "required";
      }
      hasEverFetchedRef.current = true;

      const { data, error, query } = await fetchData(
        cleanedDraftUserJourneyState,
        {
          cache,
        },
      );

      if (cache === "required" && data === null && !error) {
        setIsStale(true);
        return;
      }

      if (error) {
        setIsStale(false);
        setSubmittedUserJourneyState(cleanedDraftUserJourneyState);
      }

      if (data) {
        setSubmittedUserJourneyState(cleanedDraftUserJourneyState);
        setIsStale(false);
      }

      setUserJourneyState((prev) => ({
        ...prev,
        userJourney: data,
        error,
        query: query ?? null,
      }));
    },
    [
      cleanedDraftUserJourneyState,
      fetchData,
      isManagedWarehouse,
      isSubmittable,
      setSubmittedUserJourneyState,
    ],
  );

  const handleSubmit = useCallback(
    async (options?: { force?: boolean }) => {
      if (options?.force) {
        await doSubmit({ cache: "never" });
      } else {
        await doSubmit();
      }
    },
    [doSubmit],
  );

  const handleExtendPath = useCallback(
    async (pathToExtend: string[], stepToExtend: number) => {
      const userJourneyId = userJourneyState.userJourney?.id;
      if (!userJourneyId) return;

      const configToUse =
        userJourneyState.submittedState ?? userJourneyState.draftState;

      const { data, error } = await extendPath({
        id: userJourneyId,
        config: configToUse,
        pathToExtend,
        stepToExtend,
        cache: "never",
      });

      setUserJourneyState((prev) => ({
        ...prev,
        submittedState: configToUse,
        userJourney: data,
        error,
      }));
      if (data) {
        setIsStale(false);
      }
    },
    [
      extendPath,
      userJourneyState.userJourney?.id,
      userJourneyState.submittedState,
      userJourneyState.draftState,
    ],
  );

  const setDraftUserJourneyState = useCallback(
    (newStateOrUpdater: SetDraftUserJourneyStateAction) => {
      setUserJourneyState((prev) => {
        const newState =
          typeof newStateOrUpdater === "function"
            ? newStateOrUpdater(prev.draftState)
            : newStateOrUpdater;
        // MKTODO: add validation here if needed
        return {
          ...prev,
          draftState: newState,
        };
      });
    },
    [],
  );

  useEffect(() => {
    if (!isSubmittable) return;
    if (needsFetch) {
      doSubmit();
    } else if (needsUpdate && !needsFetch) {
      setSubmittedUserJourneyState(cleanedDraftUserJourneyState);
    }
  }, [
    cleanedDraftUserJourneyState,
    doSubmit,
    isSubmittable,
    needsFetch,
    needsUpdate,
    setSubmittedUserJourneyState,
  ]);

  useEffect(() => {
    if (isStale && !needsFetch && !needsUpdate) {
      setIsStale(false);
    }
  }, [isStale, needsFetch, needsUpdate]);

  const value = useMemo<UserJourneyContextValue>(
    () => ({
      draftUserJourneyState,
      submittedUserJourneyState,
      userJourney: userJourneyState.userJourney,
      loading,
      error: userJourneyState.error,
      query: userJourneyState.query,
      isStale,
      isSubmittable,
      needsFetch,
      needsUpdate,
      setDraftUserJourneyState,
      handleSubmit,
      handleExtendPath,
    }),
    [
      setDraftUserJourneyState,
      handleSubmit,
      loading,
      isStale,
      isSubmittable,
      needsFetch,
      needsUpdate,
      draftUserJourneyState,
      submittedUserJourneyState,
      userJourneyState.userJourney,
      userJourneyState.error,
      userJourneyState.query,
      handleExtendPath,
    ],
  );
  return (
    <UserJourneyContext.Provider value={value}>
      {children}
    </UserJourneyContext.Provider>
  );
}

export function useUserJourneyContext() {
  const context = useContext(UserJourneyContext);
  if (!context) {
    throw new Error(
      "useUserJourneyContext must be used within a UserJourneyProvider",
    );
  }
  return context;
}

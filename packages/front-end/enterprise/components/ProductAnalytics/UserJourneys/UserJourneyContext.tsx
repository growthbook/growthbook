import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { UserJourney, UserJourneyConfig } from "shared/validators";
import { QueryInterface } from "shared/types/query";
import { useUserJourneyData } from "@/enterprise/components/ProductAnalytics/useUserJourneyData";

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
  setDraftUserJourneyState: (action: SetDraftUserJourneyStateAction) => void;
  handleSubmit: () => Promise<void>;
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
  const { loading, fetchData } = useUserJourneyData();
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

  const handleSubmit = useCallback(async () => {
    const { data, error, query } = await fetchData(userJourneyState.draftState);
    setUserJourneyState((prev) => ({
      ...prev,
      submittedState: prev.draftState,
      userJourney: data,
      error,
      query: query ?? null,
    }));
  }, [fetchData, userJourneyState.draftState]);

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
  const isStale = useMemo(() => {
    if (!userJourneyState.submittedState) return false;
    return (
      JSON.stringify(userJourneyState.draftState) !==
      JSON.stringify(userJourneyState.submittedState)
    );
  }, [userJourneyState.draftState, userJourneyState.submittedState]);

  const value = useMemo<UserJourneyContextValue>(
    () => ({
      draftUserJourneyState: userJourneyState.draftState,
      submittedUserJourneyState: userJourneyState.submittedState,
      userJourney: userJourneyState.userJourney,
      loading,
      error: userJourneyState.error,
      query: userJourneyState.query,
      isStale,
      setDraftUserJourneyState,
      handleSubmit,
    }),
    [
      setDraftUserJourneyState,
      handleSubmit,
      loading,
      isStale,
      userJourneyState.draftState,
      userJourneyState.submittedState,
      userJourneyState.userJourney,
      userJourneyState.error,
      userJourneyState.query,
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

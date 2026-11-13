import type { AIUsageData } from "shared/ai";
import type { StatsEngine } from "shared/types/stats";

// An event that has no properties
type NoProps = Record<string, never>;

export interface TrackSnapshotProps {
  id: string;
  source: string;
  experiment: string;
  engine: StatsEngine;
  datasource_type: string | null;
  regression_adjustment_enabled: boolean;
  sequential_testing_enabled: boolean;
  sequential_testing_tuning_parameter?: number;
  skip_partial_data: boolean;
  activation_metric_selected: boolean;
  query_filter_selected: boolean;
  segment_selected: boolean;
  dimension_type: string;
  dimension_id: string;
  error?: string;
}
type SnapshotEventProps = TrackSnapshotProps | { error: string };

// Sent by every modal. A modal can add properties of its own with
// allowlistedTrackingEventProps.
type ModalEventProps = {
  type: string;
  source?: string;
  eventGroupUuid: string;
  [key: string]: unknown;
};

type AIFeedbackProps = {
  action: string;
  rating: string | null;
  hasComment: boolean;
};

// Every event the app tracks, mapped to its properties. `track()` and
// `growthbook.logEvent()` are checked against this, so a new event has to be
// added here first. An optional property is one that only some of the places
// tracking the event send.
export type AppEvents = {
  "Add LLM tracing": {
    type: string;
    template: string;
    errors: number;
  };
  "Added targeting": {
    savedGroupsAdded: boolean;
    prerequisitesAdded: boolean;
    conditionAdded: boolean;
  };
  "Added Variations": {
    numVariationsAdded: number;
    source: string;
    totalVariations: number;
  };
  "AI Assistant Error": {
    httpStatus?: number;
    errorType: string;
  };
  "AI Assistant Generation Cancelled": {
    model: string;
    durationMs: number;
  };
  "AI Assistant Load Conversation": NoProps;
  "AI Assistant Message Sent": {
    isFirstMessage: boolean;
    model: string;
    messageCount: number;
  };
  "AI Assistant New Conversation": {
    previousConversationMessageCount: number;
  };
  "AI Assistant Panel Closed": NoProps;
  "AI Assistant Panel Opened": NoProps;
  "AI Assistant Response Completed": {
    model: string;
    toolCallCount: number;
    durationMs: number;
  };
  "AI Autocomplete Accepted": {
    completionLength: number;
    source: string;
    draftLength: number;
  };
  "AI Autocomplete Suggested": {
    completionLength: number;
    source?: string;
    draftLength: number;
  };
  "AI Chat Delete Conversation": NoProps;
  "AI Chat Error": {
    httpStatus?: number;
    errorType: string;
  };
  "AI Chat Gating Screen Viewed": {
    reason: string;
  };
  "AI Chat Generation Cancelled": {
    model: string;
    durationMs: number;
  };
  "AI Chat Load Conversation": NoProps;
  "AI Chat Message Sent": {
    isFirstMessage: boolean;
    model: string;
    messageCount: number;
  };
  "AI Chat New Conversation": {
    previousConversationMessageCount: number;
  };
  "AI Chat Page Viewed": {
    hasInitialMessage: boolean;
  };
  "AI Chat Response Completed": {
    model: string;
    toolCallCount: number;
    durationMs: number;
  };
  "AI Chat Search": NoProps;
  "ai-suggestion": {
    type?: string;
    source?: string;
  };
  "Approve Scheduled Experiment Start": {
    action: string;
    source: string;
  };
  "auto-slices-changed-for-column": NoProps;
  "Clicked Read About CDN Limits Link": NoProps;
  "Clicked See Recent Usage From Upgrade Modal": {
    currentUsers: number;
    freeTrialAvailable: boolean;
    source: string;
    accountPlan?: string;
  };
  "Create API Key": {
    permissions: string | null;
    scoped?: boolean;
    isSecret: boolean;
    actAs?: string;
  };
  "Create Bandit": {
    numTags: number;
    source: string;
    numMetrics: number;
    numVariations: number;
    createdFromTemplate?: boolean;
  };
  "Create Contextual Bandit": {
    numTags: number;
    source: string;
    numMetrics: number;
    numVariations: number;
  };
  "Create Experiment": {
    numTags: number;
    source: string;
    numMetrics: number;
    numVariations: number;
    createdFromTemplate?: boolean;
  };
  "Create Experiment Template": {
    numTags: number;
    source: string;
    numMetrics: number;
  };
  "Create Experiment: Simple Flow": {
    source: string;
    createdFromTemplate: boolean;
  };
  "Create Fact Filter": NoProps;
  "Create Fact Metric": {
    ratio_same_fact_table?: boolean;
    conversion_window?: string;
    type: string;
    capping?: string;
    numerator_agg?: string;
    numerator_filters?: number;
    flow?: string;
    denominator_agg?: string;
    denominator_filters?: number;
    source: string;
  };
  "Create Fact Table": {
    source?: string;
  };
  "Create Holdout": {
    numTags: number;
    source: string;
    numMetrics: number;
  };
  "Create Metric Group": {
    value: { name: string; metrics: string[]; datasource: string };
    source: string;
  };
  "Create Metric Group Error": {
    value: { name: string; metrics: string[]; datasource: string };
    source: string;
    error: unknown;
  };
  "Create Organization": NoProps;
  "Create Sample Project": {
    source: string;
  };
  "Create SDK Connection": {
    remoteEvalEnabled?: boolean;
    hashSecureAttributes?: boolean;
    encryptPayload?: boolean;
    proxyEnabled?: boolean;
    languages: string[];
    source: string;
    environment?: string;
    ciphered?: boolean;
  };
  "Create Virtual Column": NoProps;
  "Create Webhook": {
    type?: string;
  };
  "Creating Datasource Resources": {
    type: string;
    source: string;
    schema?: string;
  };
  "Data Source Connect Form Error": {
    type: string;
    mode: string;
    source: string;
    error: string;
  };
  "Data Source Connection Test Failed": {
    type?: string;
    mode: string;
    source: string;
    error: string;
  };
  "Data Source Connection Test Passed": {
    type: string;
    mode: string;
    source: string;
  };
  "Data Source Form Error": {
    type?: string;
    source: string;
    error: string;
  };
  "Data Source Type Selected": {
    type: string;
    newDatasourceForm?: boolean;
  };
  "Delete Custom Field": {
    type: string;
  };
  "Delete Feature Rule": {
    entity_id_hash: string;
    type: string;
    ruleIndex: number;
    environment: string;
  };
  "Delete Prerequisite": {
    entity_id_hash: string;
    prerequisiteIndex: number;
  };
  "Delete Sample Project": {
    source: string;
  };
  "Delete variation": {
    source: string;
  };
  "Delete visual change": {
    kind: string;
    source: string;
  };
  "Delete visual changeset": {
    source: string;
  };
  "Disable Feature Rule": {
    ruleIndex: number;
    type: string;
    environment: string;
  };
  "Edit API Key": {
    permissions: string | null;
    scoped?: boolean;
    isSecret: boolean;
    actAs?: string;
  };
  "Edit Custom Experiment Field": {
    type: string;
  };
  "Edit Fact Filter": NoProps;
  "Edit Fact Metric": {
    ratio_same_fact_table?: boolean;
    conversion_window?: string;
    type: string;
    capping?: string;
    numerator_agg?: string;
    numerator_filters?: number;
    flow: string;
    denominator_agg?: string;
    denominator_filters?: number;
    source: string;
  };
  "Edit Fact Table": {
    source?: string;
  };
  "Edit Fact Table SQL": {
    type?: string;
  };
  "Edit Payment Method Modal": {
    source: string;
  };
  "Edit targeting": {
    source: string;
  };
  "Edit Virtual Column": NoProps;
  "Edit visual change": {
    source: string;
  };
  "Edit Webhook": NoProps;
  "edit-experiment-targeting": {
    action?: string;
    type?: string;
  };
  "edit-holdout-targeting": NoProps;
  "edit-metric-form-open": NoProps;
  "edit-tags": {
    numTags: number;
  };
  "edited-variation-metadata": NoProps;
  "Enable AI Callout Clicked": {
    source?: string;
  };
  "Enable Feature Rule": {
    ruleIndex: number;
    type: string;
    environment: string;
  };
  "Eppo import fetch started": {
    source: string;
  };
  "Eppo import finished": {
    completed: number;
    source: string;
    failed: number;
  };
  "Eppo import started": {
    source: string;
    items: number;
  };
  "Event Tracker Selected": {
    language: string[];
    eventTracker: string;
  };
  "Experiment Analysis: switch baseline": {
    baseline: number;
  };
  "Experiment Analysis: switch difference type": {
    differenceType: string;
  };
  "Experiment Analysis: switch precomputed-dimension": {
    dimension: string;
  };
  "Experiment Report: Click Copy Link": {
    action: string;
    type: string;
    source: string;
  };
  "Experiment Report: Click Share URL": {
    action: string;
    type: string;
    source: string;
  };
  "Experiment Report: Create": {
    source: string;
  };
  "Experiment Report: Set Edit Level": {
    type: string;
    source: string;
  };
  "Experiment Report: Set Share Level": {
    type: string;
    source: string;
  };
  "Experiment Viewed": {
    leaf_id?: number;
    variationId: string;
    userContextAttributes: { attributes: Record<string, unknown> };
    experimentId: string;
    bandit_version?: number;
    variation_weights?: string;
  };
  "experiment-hypothesis-saved-after-ai-suggestion": {
    aiUsageData: AIUsageData;
  };
  "Experiment: Click Copy Link": {
    type?: string;
    source: string;
  };
  "Experiment: Set Share Level": {
    type: string;
    source: string;
  };
  "Exported CDN Usage CSV": {
    breakdown: string;
  };
  "Feature Created": {
    entity_id_hash: string;
    initialRule: string;
    hasDescription: boolean;
    valueType: string;
  };
  "Feature Environment Toggle": {
    entity_id_hash: string;
    autoPublish: boolean;
    environments: Record<string, boolean>;
  };
  "Feature Rule Error": {
    ruleIndex: number;
    error: unknown;
    type: string;
    hasCondition?: string | boolean;
    hasSavedGroups: boolean;
    hasPrerequisites: boolean;
    environment: string;
    hasDescription: boolean;
    entity_id_hash: string;
    numEnvironments: number;
    source: string;
  };
  feedback: {
    source: string;
  };
  "Finish Essential Setup": {
    source: string;
    skippedSteps: Set<number>;
  };
  "Generate Auto Metrics CTA Clicked": {
    dataSourceId: string;
    newDatasourceForm: boolean;
    type: string;
    schema?: string;
    source: string;
  };
  "Generate Auto Metrics Error": {
    dataSourceId: string;
    newDatasourceForm: boolean;
    error: unknown;
    type: string;
    schema?: string;
    source: string;
  };
  "Generate enterprise pro license error": {
    currentUsers: number;
    error: unknown;
    accountPlan?: string;
    freeTrialAvailable: boolean;
    source: string;
  };
  "Generate enterprise trial license": {
    currentUsers: number;
    freeTrialAvailable: boolean;
    source: string;
    accountPlan?: string;
  };
  "Generate enterprise trial license error": {
    currentUsers: number;
    error: unknown;
    accountPlan?: string;
    freeTrialAvailable: boolean;
    source: string;
  };
  "Generate pro trial license": {
    currentUsers: number;
    freeTrialAvailable: boolean;
    source: string;
    accountPlan?: string;
  };
  "Generating Auto Metrics For User": {
    dataSourceId?: string;
    autoMetricsCreated: { countMetrics: number; binomialMetrics: number };
    type?: string;
    schema?: string;
    source: string;
  };
  "Health Tab Onboarding Opened": {
    source: string;
  };
  "Import Experiment Form": {
    source: string;
  };
  "Import from Eppo clicked": {
    service: string;
  };
  "Import from LaunchDarkly clicked": {
    service: string;
  };
  "Import from Statsig clicked": {
    service: string;
  };
  "Import interest clicked": {
    service: string;
  };
  "Import request submitted": {
    service: string;
  };
  "Initial signup: dismissed plan selection": {
    plan: string;
  };
  "Initial signup: flow completed": {
    plan: string;
  };
  "Initial signup: selected Pro plan": NoProps;
  "Initial signup: selected Starter plan": NoProps;
  "Initial signup: submitted payment method": NoProps;
  "Initial signup: submitted tax details": NoProps;
  "Join Organization": NoProps;
  "LaunchDarkly import fetch started": {
    step: number;
    source: string;
  };
  "LaunchDarkly import started": {
    step: number;
    source: string;
  };
  "Link Hash Attribute to Identifier Type": {
    hashAttribute: string;
    source: string;
    datasource: string;
  };
  "markdown-inline-edit-saved-after-ai-suggestion": {
    aiUsageData: AIUsageData;
  };
  "metric-auto-slices-updated": {
    newSlices: string[];
    sliceCount: number;
    previousSlices?: string[];
    metricId?: string;
  };
  MetricAnalysis_ForceUpdate: {
    type: string;
    populationType: string;
    days: number;
  };
  MetricAnalysis_ResetSettings: NoProps;
  MetricAnalysis_Update: {
    type: string;
    populationType: string;
    days: number;
    source?: string;
  };
  nps_persist_failed: {
    survey_id: string;
  };
  nps_response: {
    category: string;
    feedback: string;
    survey_id: string;
    score: number;
    preview: boolean;
    nps_value: number;
    disposition: string;
  };
  "Open health tab": {
    source: string;
  };
  "Open health tab dimension modal": NoProps;
  "Open visual editor": {
    source: string;
    status: string;
    type?: string;
  };
  "Open visual editor modal": {
    action: string;
    source: string;
  };
  "Page View": {
    pathName: string;
  };
  "power-calculation-settings-update": {
    type: string;
    source: string;
    metricsMetaData: { type: "binomial" | "mean"; effectSize: number }[];
    numMetrics: unknown;
  };
  "Presentation created": NoProps;
  "Presentation edited": NoProps;
  "Product Analytics Explorer: Chart Type Changed": {
    from_chart_type: string;
    type: string;
    source: string;
    to_chart_type: string;
  };
  "Product Analytics Explorer: Copy Link Clicked": {
    type: string;
    source: string;
    chart_type: string;
  };
  "Product Analytics Explorer: Datasource Changed": {
    type: string;
    source: string;
    from_datasource_type: string | null;
    to_datasource_type: string | null;
  };
  "Product Analytics Explorer: Refresh Failure": {
    num_dimensions: number;
    chart_type: string;
    error_message: string;
    type: string;
    num_values: number;
    datasource_type: string | null;
    source: string;
    duration_ms: number;
    cache: string;
  };
  "Product Analytics Explorer: Refresh Success": {
    num_dimensions: number;
    chart_type: string;
    type: string;
    num_values: number;
    row_count: number;
    datasource_type: string | null;
    source: string;
    duration_ms: number;
    cache: string;
  };
  "Product Analytics Explorer: Saved To Dashboard": {
    target: string;
    type: string;
    source: string;
    chart_type: string;
  };
  Register: NoProps;
  "Register-first": NoProps;
  "Renter email on Stripe": NoProps;
  "Reset Sample Project": {
    source: string;
  };
  "revert-ai-suggestion": {
    source?: string;
  };
  "Save Feature Rule": {
    ruleIndex: number;
    type: string;
    hasCondition?: string | boolean;
    hasSavedGroups: boolean;
    hasPrerequisites: boolean;
    environment: string;
    hasDescription: string | boolean;
    entity_id_hash: string;
    numEnvironments: number;
    source: string;
  };
  "Save Prerequisite": {
    entity_id_hash: string;
    source: string;
    prerequisiteIndex: number;
  };
  "SDK Language Changed": {
    language: string;
  };
  "Select health tab dimension": NoProps;
  "Select health tab traffic card dimension": NoProps;
  "Set auto approve members": {
    enabled: boolean;
  };
  "Set Up Health Tab": {
    source: string;
  };
  "SQL Query Run": {
    aiUsageData: AIUsageData;
  };
  "sql-query-saved-after-ai-suggestion": {
    aiUsageData: AIUsageData;
  };
  "Start Enterprise Checkout": {
    currentUsers: number;
    freeTrialAvailable: boolean;
    source: string;
    accountPlan?: string;
  };
  "Start experiment": {
    action: string;
    hasExperimentAssignmentQuery: boolean;
    hasDatasource: boolean;
    source: string;
  };
  "Start Stripe Checkout For Pro With Existing Subscription": {
    currentUsers: number;
    freeTrialAvailable: boolean;
    source: string;
    accountPlan?: string;
  };
  "Start Stripe Checkout For Pro Without Existing Subscription": {
    currentUsers: number;
    freeTrialAvailable: boolean;
    source: string;
    accountPlan?: string;
  };
  "Statsig import fetch started": {
    step: number;
    source: string;
  };
  "Statsig import started": {
    step: number;
    source: string;
  };
  "Stop Experiment": {
    result: string;
    aiUsageData: AIUsageData;
    isStopped: boolean;
  };
  "Stop Holdout": {
    previousStatus: string;
  };
  "StripeProvider: retry setup intent": {
    setupIntentEndpoint: string;
  };
  "Submit Datasource Connect Form": {
    setup: string;
    type: string;
    mode: string;
    source: string;
    ga4?: boolean;
  };
  "Submit Datasource Form": {
    type: string;
    source: string;
  };
  "Submit Metric Form": {
    type: string;
    source: string;
    userIdType: string;
  };
  "Switch to legacy experiment flow": NoProps;
  "Team Member Invited": {
    emailSent: boolean;
    role: string;
  };
  "tooltip-open": {
    type: string;
    source?: string;
  };
  "use-ai-suggestion": {
    source?: string;
  };
  "View Advanced Fact Metric Settings": {
    source: string;
  };
  "View Create Fact Filter Modal": NoProps;
  "View Create Virtual Column Modal": NoProps;
  "View Datasource Connect Page": {
    setup: string;
    type?: string;
    mode: string;
    source: string;
  };
  "View Datasource Form": {
    source: string;
  };
  "View Edit Fact Filter Modal": NoProps;
  "View Edit Virtual Column Modal": NoProps;
  "View Metric Form": {
    source: string;
  };
  "View SDK Connection Form": NoProps;
  "View Upgrade Modal": {
    currentUsers: number;
    freeTrialAvailable: boolean;
    source: string;
    accountPlan?: string;
  };
  "View Verify Email Modal": {
    plan: string;
  };
  "Viewed Activity Page": NoProps;
  "Viewed Create Fact Metric Modal": {
    flow: string;
    source: string;
  };
  "Viewed Create Fact Table Modal": {
    source?: string;
  };
  "Viewed Edit Fact Metric Modal": {
    flow: string;
    type?: string;
    source: string;
  };
  "Viewed Edit Fact Table Modal": {
    source?: string;
  };
  "Viewed Feature Modal": {
    source: string;
  };
  "Viewed prerequisite feature modal": {
    entity_id_hash: string;
    source: string;
  };
  "Viewed Rule Modal": {
    entity_id_hash: string;
    type: string;
    source: string;
  };
  "Watch Video Tour": {
    source: string;
  };

  // Events whose name is passed in or built at the call site
  "AI Assistant Feedback": AIFeedbackProps;
  "AI Chat Feedback": AIFeedbackProps;
  "Clicked Read About CDN Limits Link in Tooltip": NoProps;
  "Clicked Read About Event Forwarder Limits Link in Tooltip": NoProps;
  "Clicked Read About Managed Warehouse Limits Link in Tooltip": NoProps;
  "Experiment Report: create": SnapshotEventProps;
  "Experiment Report: delete": SnapshotEventProps;
  "Experiment Report: update": SnapshotEventProps;
  "Experiment Snapshot: create": SnapshotEventProps;
  "Experiment Snapshot: delete": SnapshotEventProps;
  "Experiment Snapshot: update": SnapshotEventProps;
  "Load Metric Bandits": { type: string };
  "Load Metric Experiments": { type: string };
  "modal-open": ModalEventProps;
  "modal-page-change": ModalEventProps & {
    step: number;
    steps: number;
    pageName: string;
  };
  "modal-submit-error": ModalEventProps & { error: string };
  "modal-submit-success": ModalEventProps;
};

export type AppEventName = keyof AppEvents;
export type ModalEventName =
  | "modal-open"
  | "modal-page-change"
  | "modal-submit-error"
  | "modal-submit-success";
export type AIFeedbackEventName = "AI Assistant Feedback" | "AI Chat Feedback";

declare module "@growthbook/growthbook" {
  interface Register {
    events: AppEvents;
  }
}

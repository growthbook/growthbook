# Statsig to GrowthBook Converters

This directory contains converters for importing data from Statsig to GrowthBook. The converters handle the following entity types:

- **Dynamic Configs** → GrowthBook Features
- **Feature Gates** → GrowthBook Features  
- **Layers** → GrowthBook Features
- **Experiments** → GrowthBook Experiments
- **Metrics** → GrowthBook Metrics
- **Segments** → GrowthBook Segments

## Usage

### Import the converters

```typescript
import {
  convertStatsigDynamicConfig,
  convertStatsigFeatureGate,
  convertStatsigLayer,
  convertStatsigExperiment,
  convertStatsigMetric,
  convertStatsigSegment,
} from "./statsig-converters";
```

### Convert Dynamic Configs to Features

```typescript
const statsigDynamicConfig = {
  id: "my-config",
  name: "My Dynamic Config",
  description: "A dynamic configuration",
  type: "dynamic_config",
  value: { theme: "dark", fontSize: 14 },
  defaultValue: { theme: "light", fontSize: 12 },
  rules: [
    {
      id: "rule-1",
      condition: '{"country": "US"}',
      value: { theme: "dark", fontSize: 16 },
      passPercentage: 50,
    }
  ],
  owner: {
    ownerEmail: "user@example.com",
    ownerName: "John Doe",
    ownerID: "user123",
    ownerType: "user"
  },
  environment: "production",
  isActive: true,
  createdTime: Date.now(),
  lastModifiedTime: Date.now(),
  lastModifierEmail: "user@example.com",
  lastModifierID: "user123",
  lastModifierName: "John Doe"
};

const result = convertStatsigDynamicConfig(
  statsigDynamicConfig,
  "org_123",
  "proj_456"
);

if (result.success) {
  // Use result.data to create the feature in GrowthBook
  console.log("Converted feature:", result.data);
} else {
  console.error("Conversion failed:", result.error);
}
```

### Convert Feature Gates to Features

```typescript
const statsigFeatureGate = {
  id: "my-gate",
  name: "My Feature Gate",
  description: "A feature gate",
  type: "feature_gate",
  value: true,
  defaultValue: false,
  rules: [
    {
      id: "rule-1",
      condition: '{"country": "US"}',
      value: true,
      passPercentage: 100,
    }
  ],
  owner: {
    ownerEmail: "user@example.com",
    ownerName: "John Doe",
    ownerID: "user123",
    ownerType: "user"
  },
  environment: "production",
  isActive: true,
  createdTime: Date.now(),
  lastModifiedTime: Date.now(),
  lastModifierEmail: "user@example.com",
  lastModifierID: "user123",
  lastModifierName: "John Doe"
};

const result = convertStatsigFeatureGate(
  statsigFeatureGate,
  "org_123",
  "proj_456"
);
```

### Convert Layers to Features

```typescript
const statsigLayer = {
  id: "my-layer",
  name: "My Layer",
  description: "A layer configuration",
  type: "layer",
  value: { feature1: true, feature2: "enabled" },
  defaultValue: { feature1: false, feature2: "disabled" },
  rules: [
    {
      id: "rule-1",
      condition: '{"country": "US"}',
      value: { feature1: true, feature2: "enabled" },
      passPercentage: 50,
    }
  ],
  parameterConfigs: [
    {
      name: "feature1",
      type: "boolean",
      defaultValue: false,
      description: "Enable feature 1"
    },
    {
      name: "feature2",
      type: "string",
      defaultValue: "disabled",
      description: "Feature 2 state"
    }
  ],
  owner: {
    ownerEmail: "user@example.com",
    ownerName: "John Doe",
    ownerID: "user123",
    ownerType: "user"
  },
  environment: "production",
  isActive: true,
  createdTime: Date.now(),
  lastModifiedTime: Date.now(),
  lastModifierEmail: "user@example.com",
  lastModifierID: "user123",
  lastModifierName: "John Doe"
};

const result = convertStatsigLayer(
  statsigLayer,
  "org_123",
  "proj_456"
);
```

### Convert Experiments

```typescript
const statsigExperiment = {
  id: "my-experiment",
  name: "My Experiment",
  description: "An A/B test",
  groups: [
    { id: "control", name: "Control", allocation: 50 },
    { id: "treatment", name: "Treatment", allocation: 50 }
  ],
  primaryMetrics: [
    { id: "metric1", name: "Conversion Rate" }
  ],
  secondaryMetrics: [
    { id: "metric2", name: "Revenue" }
  ],
  owner: {
    ownerEmail: "user@example.com",
    ownerName: "John Doe",
    ownerID: "user123",
    ownerType: "user"
  },
  startTime: Date.now(),
  endTime: null,
  status: "active",
  allocation: 100,
  analyticsType: "bayesian",
  sequentialTesting: false,
  createdTime: Date.now(),
  lastModifiedTime: Date.now(),
  lastModifierEmail: "user@example.com",
  lastModifierID: "user123",
  lastModifierName: "John Doe",
  idType: "stableID",
  inlineTargetingRulesJSON: "{}",
  hypothesis: "Treatment will improve conversion",
  tags: ["experiment", "conversion"],
  holdoutIDs: [],
  launchedGroupID: null,
  layerID: null,
  decisionReason: null,
  decisionTime: null,
  defaultConfidenceInterval: "95%",
  duration: 14,
  healthCheckStatus: "healthy",
  healthChecks: [],
  identityResolutionSource: null,
  lastModifierID: "user123",
  lastModifierName: "John Doe",
  primaryMetricTags: [],
  reviewSettings: { requiredReview: false, allowedReviewers: [] },
  secondaryIDType: null,
  secondaryMetricTags: [],
  summarySections: [],
  targetApps: [],
  targetingGateID: ""
};

const result = convertStatsigExperiment(
  statsigExperiment,
  "org_123",
  "proj_456"
);
```

### Convert Metrics

```typescript
const statsigMetric = {
  id: "my-metric",
  name: "My Metric",
  description: "A conversion metric",
  type: "count",
  numerator: {
    eventName: "purchase",
    valueProperty: "value"
  },
  owner: {
    ownerEmail: "user@example.com",
    ownerName: "John Doe",
    ownerID: "user123",
    ownerType: "user"
  },
  createdTime: Date.now(),
  lastModifiedTime: Date.now(),
  lastModifierEmail: "user@example.com",
  lastModifierID: "user123",
  lastModifierName: "John Doe",
  conversionWindow: {
    value: 7,
    unit: "days"
  },
  capping: {
    type: "percentile",
    value: 99
  }
};

const result = convertStatsigMetric(
  statsigMetric,
  "org_123",
  "ds_789",
  "proj_456"
);
```

### Convert Segments

```typescript
const statsigSegment = {
  id: "my-segment",
  name: "My Segment",
  description: "US users segment",
  type: "segment",
  condition: '{"country": "US"}',
  sql: "SELECT DISTINCT user_id FROM events WHERE country = 'US'",
  userIdType: "user_id",
  owner: {
    ownerEmail: "user@example.com",
    ownerName: "John Doe",
    ownerID: "user123",
    ownerType: "user"
  },
  createdTime: Date.now(),
  lastModifiedTime: Date.now(),
  lastModifierEmail: "user@example.com",
  lastModifierID: "user123",
  lastModifierName: "John Doe"
};

const result = convertStatsigSegment(
  statsigSegment,
  "org_123",
  "ds_789",
  "proj_456"
);
```

## Data Structure Mapping

### Dynamic Configs → Features
- `value` → `defaultValue` (JSON string)
- `rules` → `rules` (converted to GrowthBook rule format)
- `environment` → `environmentSettings`
- `isActive` → `archived` (inverted)

### Feature Gates → Features
- `value` → `defaultValue` (boolean string)
- `rules` → `rules` (converted to GrowthBook rule format)
- `environment` → `environmentSettings`
- `isActive` → `archived` (inverted)

### Layers → Features
- `value` → `defaultValue` (JSON string)
- `rules` → `rules` (converted to GrowthBook rule format)
- `parameterConfigs` → `jsonSchema` (if available)
- `environment` → `environmentSettings`
- `isActive` → `archived` (inverted)

### Experiments → Experiments
- `groups` → `variations`
- `primaryMetrics` → `goalMetrics`
- `secondaryMetrics` → `secondaryMetrics`
- `allocation` → `coverage` (converted to decimal)
- `analyticsType` → `statsEngine`
- `sequentialTesting` → `sequentialTestingEnabled`

### Metrics → Metrics
- `type` → `type` (mapped to GrowthBook types)
- `numerator` → SQL query construction
- `denominator` → `denominator` field
- `conversionWindow` → `windowSettings`
- `capping` → `cappingSettings`

### Segments → Segments
- `condition` → `sql` (if no SQL provided)
- `sql` → `sql`
- `userIdType` → `userIdType`
- `projects` → `projects`

## Error Handling

All converters return a result object with:
- `success: boolean` - Whether the conversion was successful
- `data?: T` - The converted data (if successful)
- `error?: string` - Error message (if failed)

Always check the `success` field before using the `data` field.

## Validation

Each converter includes validation functions that check for required fields and data types before conversion. Validation errors are returned in the error field of the result object.

## Notes

- All converters require an `organizationId` parameter
- Feature converters require an optional `projectId` parameter
- Metric and Segment converters require a `datasourceId` parameter
- Date fields are automatically converted from Unix timestamps to Date objects
- JSON values are stringified for storage in GrowthBook
- Rule conditions are expected to be JSON strings that can be parsed

# Table Migration Plan: Consolidating to Radix UI Table Component

## Overview

This document tracks the migration of all HTML `<table>` elements to the shared Radix UI `<Table>` component in `packages/front-end/ui/Table.tsx`.

**Goal**: Consolidate 124 HTML table instances across 98 files into a consistent, accessible, and maintainable Table component while preventing future direct use of `<table>` elements.

## Migration Strategy

- **Approach**: Progressive difficulty - easiest tables first, complex tables last
- **Single developer**: Focus on one phase at a time
- **Separate commits**: Each phase gets its own commit for easy rollback
- **Testing**: Manual QA + existing test suite + careful code review
- **ESLint enforcement**: Warn on existing `<table>` usage, forbid new ones

## Phase 1: Component Enhancement ✅ COMPLETED

**Status**: ✅ Committed (cf09e9ef3)

**What was done**:
- Enhanced `ui/Table.tsx` with variant, hover, stickyHeader, size props
- Created CSS bridge in `Table.module.scss` to map `.gbtable` styles to Radix
- Created `TableContainer.tsx` and styles for `.appbox` pattern
- Created `ResponsiveTable.tsx` and styles for mobile-responsive tables
- Installed `sass` package dependency

**Files created/modified**:
- ✅ `packages/front-end/ui/Table.tsx` (enhanced)
- ✅ `packages/front-end/ui/Table.module.scss` (created)
- ✅ `packages/front-end/ui/TableContainer.tsx` (created)
- ✅ `packages/front-end/ui/TableContainer.module.scss` (created)
- ✅ `packages/front-end/ui/ResponsiveTable.tsx` (created)
- ✅ `packages/front-end/ui/ResponsiveTable.module.scss` (created)
- ✅ `packages/front-end/package.json` (added sass dependency)

## Phase 2: Pilot Migration (10 Simple Tables) ✅ COMPLETED

**Status**: ✅ Committed (c5acd1503)

**Target**: Migrate 10 simplest tables to validate approach and build confidence

**Files migrated**:
1. ✅ `/packages/front-end/pages/segments/index.tsx`
2. ✅ `/packages/front-end/pages/environments.tsx`
3. ✅ `/packages/front-end/pages/projects/index.tsx`
4. ✅ `/packages/front-end/pages/attributes.tsx`
5. ✅ `/packages/front-end/pages/namespaces.tsx`
6. ✅ `/packages/front-end/components/Settings/Teams/TeamsList.tsx`
7. ✅ `/packages/front-end/components/Teams/Roles/RoleList.tsx`
8. ✅ `/packages/front-end/pages/settings/tags.tsx`
9. ✅ `/packages/front-end/components/Metrics/MetricGroupsList.tsx`
10. ✅ `/packages/front-end/components/FactTables/FactMetricList.tsx`

**Migration pattern established**:
1. Add imports: `Table, TableHeader, TableBody, TableRow, TableColumnHeader, TableCell`
2. Convert `<table className="table appbox gbtable table-hover">` → `<Table variant="standard" hover className="appbox">`
3. Replace HTML elements with Radix equivalents:
   - `<thead>` → `<TableHeader>`
   - `<tbody>` → `<TableBody>`
   - `<tr>` → `<TableRow>`
   - `<th>` → `<TableColumnHeader>`
   - `<td>` → `<TableCell>`
4. Preserve all Bootstrap responsive classes, interactive elements, and existing logic

**Commit**: "feat: migrate 10 simple tables to Radix Table component (Phase 2 pilot)"

## Phase 3: Standard Tables (Batch 1) ✅ COMPLETED

**Status**: ✅ Committed (de3a9ef0d)

**Target**: Migrate standard tables with `.gbtable` class

**Files migrated** (10 tables):
1. ✅ `components/Settings/Webhooks.tsx`
2. ✅ `components/Settings/DataSources.tsx`
3. ✅ `components/License/ShowLicenseInfo.tsx`
4. ✅ `components/SavedQueries/SavedQueriesList.tsx`
5. ✅ `components/CustomFields/CustomFields.tsx` (with drag-and-drop)
6. ✅ `components/SavedGroups/ConditionGroups.tsx`
7. ✅ `components/SavedGroups/IdLists.tsx`
8. ✅ `components/Settings/Team/InviteList.tsx`
9. ✅ `components/Settings/Team/PendingMemberList.tsx`
10. ✅ `components/Settings/Team/MemberList.tsx` (with sorting & pagination)

**Commit**: "feat: migrate 10 standard tables to Radix Table component (Phase 3 Batch 1)"

## Phase 3: Standard Tables (Batch 2) ✅ COMPLETED

**Status**: ✅ Committed (90b065c96)

**Files migrated** (15 tables):
- Billing/PaymentInfo.tsx
- EventWebHookLogs.tsx, MetricTooltipBody.tsx
- OrphanedUsersList.tsx, DimensionSlicesRunner.tsx
- GrowthBookSetupCodeSnippet.tsx, ArchetypeList.tsx
- HistoryTable.tsx (expandable rows)
- PowerCalculationContent.tsx (3 tables!)
- FactTableSchema.tsx, ColumnModal.tsx, FactFilterModal.tsx
- ColumnList.tsx, FactFilterList.tsx, ApiKeysTable.tsx

## Phase 3: Standard Tables (Batch 3) ✅ COMPLETED

**Status**: ✅ Committed (c97eef36c)

**Files migrated** (21 files, 22 tables):
- MetricCorrelationsExperimentTable.tsx, ExecExperimentImpact.tsx
- MetricsList.tsx, DisplayTestQueryResults.tsx
- DataSourceViewEditExperimentProperties.tsx
- SimulateFeatureValues.tsx, ArchetypeResults.tsx
- ExperimentWinRateByProject.tsx
- ExperimentsListTable.tsx, EditPhasesModal.tsx
- ExperimentList.tsx, ImportExperimentList.tsx
- ExperimentReportsList.tsx, MetricExperiments.tsx
- ShareModal.tsx, queries/[did].tsx
- saved-groups/[sgid].tsx, features/index.tsx (sticky)
- dashboards/index.tsx, activity.tsx, admin.tsx (2 tables)

## Phase 3: Recovered WIP Tables ✅ COMPLETED

**Status**: ✅ Committed (b32d63b78)

**Files migrated** (16 tables):
- AutoGenerateMetricsModal.tsx, SDKConnectionsList.tsx
- SdkWebhooks.tsx, SDKEndpoints.tsx
- NeedingAttention.tsx, AutoMetricCard.tsx
- bandits/index.tsx, dimensions/index.tsx
- exposure-debugger.tsx, fact-tables/index.tsx
- features/FeaturesDraftTable.tsx, holdouts/index.tsx
- reports.tsx, custom-hooks.tsx
- team/[tid].tsx, webhooks/index.tsx

## Phase 4: Tables with .appbox ⏳ PENDING

**Target**: ~70 tables wrapped in `.appbox` containers

**Approach**: Use `TableContainer` wrapper component

**Files**: TBD

**Estimated effort**: 1 week

## Phase 5: Responsive Tables ⏳ PENDING

**Target**: 8 tables with `.responsive-table` class and mobile `data-title` attributes

**Files**:
- `/packages/front-end/pages/settings/webhooks.tsx`
- `/packages/front-end/pages/settings/webhooks/[webhookid].tsx`
- `/packages/front-end/components/Settings/EventWebhookAddEditModal.tsx`
- `/packages/front-end/components/Settings/EventWebhookEditParams.tsx`
- `/packages/front-end/components/Settings/EventWebhookLogs.tsx`
- `/packages/front-end/components/Settings/EventWebhookPage.tsx`
- `/packages/front-end/components/Settings/WebhooksPage.tsx`

**Approach**: Use `ResponsiveTable` wrapper component with `mobileDataTitles` prop

**Estimated effort**: 1-2 days

## Phase 6: Complex Feature Flag Tables ⏳ PENDING

**Target**: 12 tables in feature flag management pages

**Challenges**: Complex state management, drag-and-drop, inline editing

**Files**:
- `/packages/front-end/pages/features/index.tsx`
- `/packages/front-end/pages/features/[fid].tsx`
- `/packages/front-end/components/Features/*` (various files)

**Estimated effort**: 3-4 days

## Phase 7: Experiment & Metric Tables ⏳ PENDING

**Target**: 18 tables in experiment and metric pages

**Challenges**: Data visualization integration, sorting, filtering

**Files**:
- `/packages/front-end/pages/experiments/*`
- `/packages/front-end/pages/metrics/*`
- `/packages/front-end/components/Experiment/*`

**Estimated effort**: 3-4 days

## Phase 8: Complex Results Tables (Final Phase) ⏳ PENDING

**Target**: Most complex tables deferred to last

**Files**:
- `/packages/front-end/components/Experiment/ResultsTable.tsx`
- `/packages/front-end/components/Experiment/CompactResults.tsx`
- Other highly complex data tables

**Challenges**:
- Custom rendering logic
- Complex state management
- Statistical data display
- Performance optimization needed

**Approach**:
- Extend Table component with additional variants/props as needed
- Consider creating specialized wrapper components
- May require CSS-in-JS or additional SCSS modules

**Estimated effort**: 1 week

## Phase 9: ESLint Enforcement ⏳ PENDING

**Target**: Add ESLint rule to prevent new `<table>` usage

**Implementation**:
```json
{
  "rules": {
    "react/forbid-elements": [
      "warn",
      {
        "forbid": [
          {
            "element": "table",
            "message": "Use <Table> from ui/Table instead of <table>"
          }
        ]
      }
    ]
  }
}
```

**Location**: `packages/front-end/.eslintrc.js`

**Timing**: After Phase 2 is complete and validated

## Inventory Summary

**Total HTML tables found**: 124 instances across 98 files

**CSS classes identified**:
- `.gbtable` - Primary table styling (rounded corners, borders, hover effects)
- `.appbox` - Container wrapper (~70 instances)
- `.table-hover` - Row hover effects
- `.responsive-table` - Mobile-responsive tables (8 instances)
- `.table` - Bootstrap base class
- `.table-bordered` - Bootstrap bordered variant

**Variants needed**:
- `variant="standard"` - Default `.gbtable` styling
- `variant="compact"` - Dense table layout
- `variant="bordered"` - Bordered cells
- `variant="query"` - SQL query results tables
- `hover={true}` - Row hover effects
- `stickyHeader={true}` - Fixed header on scroll
- `size="sm" | "md"` - Size variations

## Timeline Estimate

- **Phase 2**: 1-2 days (pilot migration + validation)
- **Phase 3**: 2-3 days (standard tables batch)
- **Phase 4**: 1 week (appbox tables)
- **Phase 5**: 1-2 days (responsive tables)
- **Phase 6**: 3-4 days (feature flag tables)
- **Phase 7**: 3-4 days (experiment/metric tables)
- **Phase 8**: 1 week (complex results tables)
- **Phase 9**: 1 day (ESLint rule)

**Total**: 6-8 weeks (single developer, full-time)

## Success Criteria

- ✅ All 124 tables migrated to Radix UI Table component
- ✅ Visual parity maintained (no regressions)
- ✅ All existing tests pass
- ✅ ESLint rule prevents new `<table>` usage
- ✅ Documentation updated
- ✅ Component API is intuitive and maintainable

## Rollback Plan

Each phase has its own commit, allowing easy rollback:
```bash
git revert <commit-hash>  # Revert specific phase
```

## Notes

- **CSS Bridge**: `Table.module.scss` maps legacy `.gbtable` styles to Radix components for seamless visual transition
- **Bootstrap Classes**: Preserve all Bootstrap responsive classes (`d-none`, `d-sm-table-cell`, etc.) during migration
- **Interactive Elements**: Preserve all existing functionality (MoreMenu, DeleteButton, Links, sorting, filtering, etc.)
- **Testing**: Manual QA each phase + run existing test suite + careful code review
- **Performance**: Monitor bundle size and runtime performance, especially for large tables

## Questions/Decisions Log

1. **Migration order**: ✅ Easiest to hardest, single developer
2. **Complex ResultsTable**: ✅ Defer to Phase 8 (last)
3. **ESLint approach**: ✅ Warn on existing, forbid new `<table>` usage
4. **Testing strategy**: ✅ Manual QA + existing tests + code review (no visual regression tools)
5. **Scope**: ✅ Migrate all 124 tables in separate commits by phase

## Current Status

**Last updated**: 2025-12-05

**Current phase**: Phase 3 - ✅ ALL SIMPLE TABLES COMPLETED!

**Progress**: ~72 of ~110 tables migrated (65%)

**Tables migrated by phase:**
- Phase 1: Component enhancement ✅
- Phase 2: 10 pilot tables ✅
- Phase 3 Batch 1: 10 tables ✅
- Phase 3 Batch 2: 15 tables ✅
- Phase 3 Batch 3: 21 files (22 tables) ✅
- Recovered WIP: 16 tables ✅
- **Total: 72+ tables migrated**

**Remaining**: ~38 files with complex tables

**Next step**: Tackle remaining complex tables (experiment results, feature flags, etc.)

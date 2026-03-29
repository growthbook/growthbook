# ConditionInput Refactor Plan

## New Props API

```typescript
interface Props {
  defaultValue: string;
  onChange: (value: string) => void;
  project: string;
  labelClassName?: string;
  emptyText?: string;
  label?: string; // Changed from title
  labelCheckbox?: ReactNode; // NEW - for "Controlled by ramp-up" checkbox
  locked?: boolean; // NEW
  require?: boolean;
  allowNestedSavedGroups?: boolean;
  excludeSavedGroupId?: string;
  slimMode?: boolean;
}
```

## Key Changes

1. Rename `title` prop to `label`
2. Add `labelCheckbox` prop for the checkbox element
3. Add `locked` prop (thread through to all controls)
4. Default label to "Target by Attributes"
5. Component handles the layout internally - no more Flex/width passed from parent
6. Remove opacity: 0.5 styling, use color="text-low" for disabled links
7. All form controls accept `disabled={locked}`
8. Remove buttons always render but are disabled
9. Advanced toggle disabled when locked

## StandardRuleFields Changes

Instead of:

```tsx
<ConditionInput
  title={
    inRamp ? (
      <Flex justify="between" style={{ width: "100%" }}>
        <span>Target by Attributes</span>
        <Checkbox ... />
      </Flex>
    ) : undefined
  }
  locked={isRampControlled("condition")}
/>
```

New:

```tsx
<ConditionInput
  label="Target by Attributes"
  labelCheckbox={
    inRamp && VALID_STEP_FIELDS.includes("condition") ? (
      <Checkbox
        value={rampActiveFields.has("condition")}
        setValue={(v) => toggleRampField("condition", v)}
        label="Controlled by ramp-up"
      />
    ) : undefined
  }
  locked={isRampControlled("condition")}
/>
```

Same pattern for SavedGroupTargetingField and PrerequisiteInput.

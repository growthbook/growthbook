
  | Event name | Description |
  |------------|-------------|
  | **[feature.created](#featurecreated)** | Triggered when a feature is created |
| **[feature.updated](#featureupdated)** | Triggered when a feature is updated |
| **[feature.deleted](#featuredeleted)** | Triggered when a feature is deleted |
| **[feature.saferollout.ship](#featuresaferolloutship)** | Triggered when a safe rollout is completed and safe to rollout to 100%. |
| **[feature.saferollout.rollback](#featuresaferolloutrollback)** | Triggered when a safe rollout has a failing guardrail and should be reverted. |
| **[feature.saferollout.unhealthy](#featuresaferolloutunhealthy)** | Triggered when a safe rollout is failing a health check and may not be working as expected. |
| **[experiment.created](#experimentcreated)** | Triggered when an experiment is created |
| **[experiment.updated](#experimentupdated)** | Triggered when an experiment is updated |
| **[experiment.deleted](#experimentdeleted)** | Triggered when an experiment is deleted |
| **[experiment.warning](#experimentwarning)** | Triggered when a warning condition is detected on an experiment |
| **[experiment.info.significance](#experimentinfosignificance)** | Triggered when a goal or guardrail metric reaches significance in an experiment (e.g. either above 95% or below 5% chance to win). Be careful using this without Sequential Testing as it can lead to peeking problems. |
| **[experiment.decision.ship](#experimentdecisionship)** | Triggered when an experiment is ready to ship a variation. |
| **[experiment.decision.rollback](#experimentdecisionrollback)** | Triggered when an experiment should be rolled back to the control. |
| **[experiment.decision.review](#experimentdecisionreview)** | Triggered when an experiment has reached the desired power point, but the results may be ambiguous. |
| **[user.login](#userlogin)** | Triggered when a user logs in |

  
### feature.created

Triggered when a feature is created

<details>
  <summary>Payload</summary>

```typescript
any
```
</details>


### feature.updated

Triggered when a feature is updated

<details>
  <summary>Payload</summary>

```typescript
any
```
</details>


### feature.deleted

Triggered when a feature is deleted

<details>
  <summary>Payload</summary>

```typescript
any
```
</details>


### feature.saferollout.ship

Triggered when a safe rollout is completed and safe to rollout to 100%.

<details>
  <summary>Payload</summary>

```typescript
any
```
</details>


### feature.saferollout.rollback

Triggered when a safe rollout has a failing guardrail and should be reverted.

<details>
  <summary>Payload</summary>

```typescript
any
```
</details>


### feature.saferollout.unhealthy

Triggered when a safe rollout is failing a health check and may not be working as expected.

<details>
  <summary>Payload</summary>

```typescript
any
```
</details>


### experiment.created

Triggered when an experiment is created

<details>
  <summary>Payload</summary>

```typescript
any
```
</details>


### experiment.updated

Triggered when an experiment is updated

<details>
  <summary>Payload</summary>

```typescript
any
```
</details>


### experiment.deleted

Triggered when an experiment is deleted

<details>
  <summary>Payload</summary>

```typescript
any
```
</details>


### experiment.warning

Triggered when a warning condition is detected on an experiment

<details>
  <summary>Payload</summary>

```typescript
any
```
</details>


### experiment.info.significance

Triggered when a goal or guardrail metric reaches significance in an experiment (e.g. either above 95% or below 5% chance to win). Be careful using this without Sequential Testing as it can lead to peeking problems.

<details>
  <summary>Payload</summary>

```typescript
any
```
</details>


### experiment.decision.ship

Triggered when an experiment is ready to ship a variation.

<details>
  <summary>Payload</summary>

```typescript
any
```
</details>


### experiment.decision.rollback

Triggered when an experiment should be rolled back to the control.

<details>
  <summary>Payload</summary>

```typescript
any
```
</details>


### experiment.decision.review

Triggered when an experiment has reached the desired power point, but the results may be ambiguous.

<details>
  <summary>Payload</summary>

```typescript
any
```
</details>


### user.login

Triggered when a user logs in

<details>
  <summary>Payload</summary>

```typescript
any
```
</details>


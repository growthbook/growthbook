# The revision engines

Everything under `packages/back-end/src/revisions` exists to answer one question
safely: **how does a proposed change become the live state of an SDK-critical
entity, and what happens when that goes wrong halfway?**

There are two engines. They answer the same questions and share their rules, but
they store revisions differently:

|               | Generic engine                           | Feature engine                              |
| ------------- | ---------------------------------------- | ------------------------------------------- |
| Entities      | Configs, Constants, Saved Groups         | Feature Flags                               |
| Model         | `RevisionModel` (`revisions` collection) | `FeatureRevisionModel` (`featurerevisions`) |
| Addressed by  | revision `id`                            | `(organization, featureId, version)`        |
| Change format | JSON Patch ops over a snapshot           | whole-revision fields                       |

Shared rules live in one place so the two cannot drift: `landAuthority.ts`
(who may discard / advance / rebase / land), `reviewCycle.ts` (which round of
review a verdict belongs to), and `casLoop.ts` (the compare-and-swap skeleton).

---

## 1. Revision lifecycle

A revision is a proposed change plus the record of its review. `merged` and
`discarded` are terminal.

```mermaid
stateDiagram-v2
    [*] --> draft: create
    draft --> pending_review: submitForReview
    pending_review --> approved: addReview(approve)
    pending_review --> changes_requested: addReview(request-changes)
    changes_requested --> approved: addReview(approve)
    approved --> changes_requested: addReview(request-changes)

    pending_review --> draft: recallReview
    changes_requested --> draft: recallReview
    approved --> draft: recallReview

    approved --> pending_review: undoReview
    changes_requested --> pending_review: undoReview

    draft --> merged: merge (publish)
    approved --> merged: merge (publish)
    draft --> discarded: close
    pending_review --> discarded: close
    approved --> discarded: close
    changes_requested --> discarded: close

    discarded --> draft: reopen
    merged --> draft: reopenAfterFailedApply

    merged --> [*]
    discarded --> [*]

    note right of pending_review
        Every arrow back into this group
        starts a NEW review cycle and
        increments reviewCycle.
    end note
```

**Why `reviewCycle` exists.** Recall-then-resubmit returns a revision to
`pending-review` — the value it already held. A verdict formed against the
retracted round would satisfy every status check and land on the new one, so a
stale approve could approve changes nobody reviewed. Status cannot identify a
round; a monotonic counter can.

---

## 2. Landing a revision

The dangerous part. The merge claim lives in the revisions collection and the
entity write lives in another, and there are **no transactions** — DocumentDB
and CosmosDB have to keep working. Every step below exists because that pair
cannot be made atomic.

```mermaid
flowchart TD
    A[publishRevision] --> B{gates pass?<br/>approval, schema,<br/>hooks, locks}
    B -- no --> B1[422 with the gates<br/>that blocked]
    B -- yes --> C[merge: CLAIM<br/>status → merged]
    C --> D[assertLandingBaseline<br/>entity unchanged AND<br/>we are newest merged]
    D -- conflict --> D1[409 · nothing written<br/>revision reopened]
    D -- ok --> E[runGuardedWrite<br/>entity CAS on dateUpdated]
    E -- CAS lost --> D1
    E -- written --> F[assertLandingStillOwned<br/>still newest merged?]
    F -- no --> G
    F -- yes --> H[satellites:<br/>holdout · bandits ·<br/>safe rollouts · ramps]
    H -- throws --> G[compensation]
    H -- ok --> I[dispatch events<br/>refresh SDK payload]
    I --> J([landed])

    G --> G1[restore satellites<br/>ownership-checked]
    G1 --> G2[restore entity<br/>only if live still<br/>holds what we wrote]
    G2 --> G3[reopen revision<br/>LAST, so it is never<br/>a draft while live<br/>stays published]
    G3 --> G4([retryable])

    style C fill:#fff4e6,stroke:#e8a33d
    style E fill:#fff4e6,stroke:#e8a33d
    style G fill:#ffe6e6,stroke:#d66
```

**The ordering rule in compensation is the whole point:** live state goes back
first, the revision record goes back last. A live change with no revision
recording it is the one outcome nothing can repair, so the record is kept
whenever live cannot be put back.

---

## 3. Who may do what, and on which basis

The single most repeated defect in this area was asking the right question about
the wrong entity. Verbs that belong to the **revision** are judged on
`target.snapshot` — the entity as it was when the draft was opened. Verbs that
**land** are judged on the **live** entity, because that is where the change
arrives.

```mermaid
flowchart LR
    subgraph revision["Judged on target.snapshot"]
        R1[draft / edit]
        R2[review]
        R3[comment]
        R4[recall · discard]
    end
    subgraph live["Judged on the LIVE entity"]
        L1[publish]
        L2[revert]
        L3[archive · delete]
        L4[arm auto-publish]
        L5[rebase]
    end
    revision -.->|canRevisionOwnedAction<br/>takes no scope argument| X[adapter hooks]
    live -.->|canDoRevisionAction<br/>explicit scope| X
```

`canRevisionOwnedAction` deliberately has no scope parameter: both bases have
the same TypeScript type, so a parameter is a standing invitation to pass the
wrong one.

**Authority is re-asked inside every CAS attempt.** A caller's permission check
runs once, against the row it read; the loop then re-reads on retry and can land
on a row a concurrent rebase moved into a project the caller holds nothing in.
Guarding the moved field does not close this — the guard makes the first attempt
lose, and the retry proceeds against the new row. `CasAuthority` is therefore a
required argument, with an explicit `authorizedByFlow` variant for writes whose
authority the calling flow already established.

---

## 4. Deferred publishing

A revision can be armed to publish later — on approval, on a date, or both.

```mermaid
flowchart TD
    A[draft] -->|arm| B[armed<br/>autoPublishOnApproval]
    A -->|schedule| C[scheduled<br/>scheduledPublishAt]
    B -->|approval lands| D[publish now]
    C -->|poller, date reached| D
    B -->|changes-requested| E[disarmed<br/>schedule scrubbed]
    C -->|cancel| E
    D -->|fails| F{transient or<br/>terminal?}
    F -->|transient| G[backoff · retry]
    F -->|terminal| H[parked<br/>publishFailed event<br/>draft left open]
    G -->|attempts exhausted| H
```

Arming captures **acknowledgment fingerprints** of the content being armed. The
fire-time check reads them as consent, so arming guards `target` — content that
changed after the arm would otherwise publish under an acknowledgment nobody
gave.

---

## 5. When a landing does not complete

```mermaid
flowchart TD
    A[revision is merged] --> B{did the entity<br/>write land?}
    B -->|yes| C([healthy])
    B -->|no| D[stranded merge]
    D --> E{does live still match<br/>the revision's base?}
    E -->|yes| F[republish re-applies it<br/>recoverStrandedMerge]
    E -->|no| G[another revision landed<br/>in between]
    G --> H[recovery refuses<br/>needs a manual rebase]

    style H fill:#ffe6e6,stroke:#d66
```

`recoverStrandedMerge` **is** the republish path, not automation on top of it:
publishing a `merged` revision routes through it. The red branch is the case the
landing fences exist to prevent, and the reason they are worth their cost.

---

## Reading order

1. `revisionActions.ts` — `publishRevision` is the spine; everything else hangs off it.
2. `landingSequence.ts` — the fences and the compensation ordering.
3. `casLoop.ts` — every guarded write goes through it.
4. `landAuthority.ts` + `revisionAuthority.ts` — the rules, stated once.
5. `bulkPublish/` — the same sequence across several entities, all-or-nothing.

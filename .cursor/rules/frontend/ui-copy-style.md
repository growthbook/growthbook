# UI Copy & Casing

How to capitalize user-facing strings in the front-end. Read this before writing or editing any label, heading, button, placeholder, or body copy.

## The two-tier casing rule

Two cases, chosen by element type.

- **Title Case** for `<Heading>` elements. Section and sub-section titles. Example "Data Source Settings", "Experiment Health Settings".
- **Sentence case** for everything else. Field labels, checkbox and switch labels, select labels, buttons, placeholders, tooltips, helper text, and body copy. Capitalize only the first word. Example "Require unique experiment keys", "Add custom", "New template".

Sentence case is the default for actions and labels. This matches modern product convention (Google Material, Shopify Polaris, Atlassian). Buttons are sentence case, not Title Case. "Save", "Regenerate all", "Import from another service".

## Named resources are always Title Case

There is one exception that overrides the rule above. A first-class GrowthBook resource keeps its Title Case spelling everywhere, including mid-sentence in body copy and inside an otherwise sentence-case label. These are the named things users see in the sidebar or recognize as models, so they read as proper nouns.

The glossary:

| Term           | Plural          | Notes                                                                                                                        |
| -------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| GrowthBook     | —               | The product. Never "Growthbook" or "growthbook".                                                                             |
| Visual Editor  | —               | The product feature.                                                                                                         |
| North Star     | North Stars     | The metric concept.                                                                                                          |
| Bandit         | Bandits         |                                                                                                                              |
| Data Source    | Data Sources    |                                                                                                                              |
| Fact Metric    | Fact Metrics    | Lowercase "metric" only when not referring to the Fact Metric resource.                                                      |
| Feature Flag   | Feature Flags   |                                                                                                                              |
| Saved Group    | Saved Groups    |                                                                                                                              |
| SDK Connection | SDK Connections |                                                                                                                              |
| All Projects   | —               | The scope label or option meaning every project. Title Case as a fixed phrase. Bare "project" stays a lowercase common noun. |

So a sentence-case label still reads "Require approval to modify Saved Groups", and body copy still reads "users will only be able to create Fact Metrics".

A common noun that is not a named resource stays lowercase mid-sentence. "experiment", "metric", "dimension", "segment", "environment", "project". Only the terms in the glossary above are promoted to proper nouns. Note that "project" is lowercase as a common noun ("select a project") but the fixed scope label "All Projects" is Title Case.

## Adding to the glossary

Add a term when it names a first-class resource a user manages, typically something with its own sidebar entry, model, or top-level page. Do not add common nouns or UI concepts. When in doubt, leave it lowercase. Keep the table above as the single source of truth and update it in the same change that introduces the term.

## Examples

```
Heading:      "Metrics Settings"                    (Title Case, it is a heading)
Label:        "Require fact metrics"                 wrong
Label:        "Require Fact Metrics"                 right, Fact Metric is a named resource
Label:        "Minimum metric total"                 right, "metric" here is a common noun
Button:       "New Template"                         wrong, buttons are sentence case
Button:       "New template"                         right
Body:         "These are organizational defaults"    sentence case
Body:         "...move between growthbook accounts"  wrong, it is GrowthBook
```

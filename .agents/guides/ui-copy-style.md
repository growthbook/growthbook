# Copy & Casing

How to capitalize and phrase user-facing strings across GrowthBook. Read this before writing or editing any user-facing copy — front-end (labels, headings, buttons, placeholders, body copy) or back-end (API error messages, validation messages, and any string returned to a user or an API caller).

The rules are the same everywhere; only the surfaces differ. The front-end has UI elements (headings vs. everything else); the back-end has no headings, so its messages follow the sentence-case rule below. The named-resource glossary applies identically in both.

## The two-tier casing rule

Two cases, chosen by element type.

- **Title Case** for `<Heading>` elements. Section and sub-section titles. Example "Data Source Settings", "Experiment Health Settings".
- **Sentence case** for everything else. Field labels, checkbox and switch labels, select labels, buttons, placeholders, tooltips, helper text, and body copy. Capitalize only the first word. Example "Require unique experiment keys", "Add custom", "New template".

Sentence case is the default for actions and labels. This matches modern product convention. Buttons are sentence case, not Title Case. "Save", "Regenerate all", "Import from another service".

## Back-end and API messages

Error messages, validation messages, and any other string the back-end returns to a user or API caller are body copy: use **sentence case**, with named resources kept Title Case per the glossary below. There are no headings in this context, so the Title-Case-for-headings tier does not apply.

- Right: `throw new Error("Feature key must be unique within the Project");`
- Right: `context.permissions.throwPermissionError("You do not have permission to modify this Saved Group");`
- Wrong: `throw new Error("Feature Key Must Be Unique");` (not a heading — use sentence case)
- Wrong: `throw new Error("could not find data source");` (Data Source is a named resource → Title Case, and start with a capital)

Write full, punctuated sentences where the message is a sentence. Keep interpolated identifiers (ids, keys, field names) verbatim — they are data, not prose.

## Named resources are always Title Case

There is one exception that overrides the rule above. A first-class GrowthBook resource keeps its Title Case spelling everywhere, including mid-sentence in body copy and inside an otherwise sentence-case label. These are the named things users see in the sidebar or recognize as models, so they read as proper nouns.

The glossary:

| Term                          | Plural                         | Notes                                                                                                                       |
| ----------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| GrowthBook                    | —                              | The product. Never "Growthbook" or "growthbook".                                                                            |
| Visual Editor                 | —                              | The product feature.                                                                                                        |
| North Star                    | North Stars                    | The metric concept.                                                                                                         |
| Bandit                        | Bandits                        |                                                                                                                             |
| Data Source                   | Data Sources                   |                                                                                                                             |
| Fact Metric                   | Fact Metrics                   | Lowercase "metric" only when not referring to the Fact Metric resource.                                                     |
| Feature Flag                  | Feature Flags                  | Use the full "Feature Flag" in user-facing copy. Do not use the shorthand "Feature" or "Flag" as the term.                  |
| Saved Group                   | Saved Groups                   |                                                                                                                             |
| SDK Connection                | SDK Connections                |                                                                                                                             |
| Experiment Template           | Experiment Templates           | The full compound is a named resource. Bare "template" stays a lowercase common noun ("select a template", "New template"). |
| Experiment Decision Framework | -                              | Title Case. Abbreviated as "EDF".                                                                                           |
| Metric Slices                 | —                              | The metric-slicing feature (overall).                                                                                       |
| Auto Slice                    | Auto Slices                    | Automatically populates and manages Metric Slices. The word "levels" in "Auto Slice levels" stays a lowercase common noun.  |
| Project                       | Projects                       | A first-class resource with its own sidebar entry and page. "All Projects" is the fixed scope label meaning every Project.  |

So a sentence-case label still reads "Require approval to modify Saved Groups", and body copy still reads "users will only be able to create Fact Metrics".

A common noun that is not a named resource stays lowercase mid-sentence. "experiment", "metric", "dimension", "segment", "environment". Only the terms in the glossary above are promoted to proper nouns. "Project" is a named resource and is Title Case everywhere ("Select a Project", "All Projects"), but a "project" belonging to another product (a BigQuery, GCP, or Amplitude project) is that product's common noun and stays lowercase. Hyphenated modifiers like "per-project" and "project-level" stay lowercase. "All Environments" is a fixed scope label and uses Title Case, but bare "environment" or "environments" remains lowercase.

Technical identifiers stay lowercase in prose — "experiment key", "experiment tracking key", "API key", "attribute", "token". These are technical concepts, not named resources, and follow the same convention as, e.g., a personal access token: lowercase unless a word starts the sentence.

Product-area names are a gray area. When a term like "Experiments" names the product area or feature itself rather than counting individual experiments, Title Case can apply — decide per case, and default to lowercase when unsure. This is unsettled; do not mass-apply it. (Example currently in use: "Enable fallback attributes in Experiments".)

## Adding to the glossary

Add a term when it names a first-class resource a user manages, typically something with its own sidebar entry, model, or top-level page. Do not add common nouns or UI concepts. When in doubt, leave it lowercase. Keep the table above as the single source of truth and update it in the same change that introduces the term.

## Examples

```
Heading:      "Metrics Settings"                    (Title Case, it is a heading)
Label:        "Require fact metrics"                 wrong
Label:        "Require Fact Metrics"                 right, Fact Metric is a named resource
Label:        "Minimum metric total"                 right, "metric" here is a common noun
Button:       "New Template"                         wrong, buttons are sentence case
Button:       "New template"                         right, bare "template" is a common noun
Label:        "Require experiment templates"         wrong, Experiment Template is a named resource
Label:        "Require Experiment Templates"         right
Label:        "Require unique experiment keys"       right, "experiment key" is a technical identifier
Body:         "These are organizational defaults"    sentence case
Body:         "...move between growthbook accounts"  wrong, it is GrowthBook
API error:    "Metric not found"                     right, sentence case
API error:    "This Saved Group is in use"           right, named resource stays Title Case
API error:    "Invalid Data source ID"               wrong, it is Data Source
```

# Claude : Splitting Submissions.js

2026-09-25. TODO.md §6 named `src/contrib/Submissions.js` (760 lines) as three
things with one seam: the `SUBMITTABLE` table with its vocabulary composition,
the `validate` / `valueTerm` pair, and the `Submissions` flow class. The table
changes when a field is added, the class when the moderation flow changes.

## What was done

- `src/contrib/submittable.js` (new): `SubmissionError`, `PLUGIN_FORMATS`,
  `SUBMITTABLE`, the composition (`withProfileVocabulary`, `loadSubmittable`,
  `profileLabels`) and the checking pair — moved byte-exact by line slice,
  not retyped. `SubmissionError` went with the table so the new module stands
  alone with no import cycle back.
- `src/contrib/Submissions.js` (348 lines): the class untouched, importing
  what it uses and re-exporting the moved names — a dozen importers across
  `src/`, `bin/` and `tests/` move nowhere.

## Verification

- The whole core suite passes unedited (69 files, 1424 tests), which is the
  definition of a refactor here. Store `submissions` and `contributions`
  green against the local Fuseki. No stale `rdfs`/`foaf` references left
  behind; the one bulk-edit hazard (an off-by-one slice) fired its assertion
  before writing, on the backup, and was redone.

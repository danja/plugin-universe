# Claude : Download links where the artefacts are

2026-09-25. The inbox asked for direct download links on the plugin profile,
and TODO.md already carried the sibling item for the plugin page: `pu:downloadUrl`
written per package file since Phase 1, read back only by the registry index.
Built both halves together, since they are one fact in two presentations.

## What was built

- `sparql/queries/plugin/downloads.sparql` (new): one row per package file —
  plugin, URL, and the source's own system tokens concatenated. A file the
  source said nothing about still returns its row with empty systems, so an
  artefact is never hidden for having an unknown platform. Nothing inferred.
- `groupDownloads` / `downloadLabel` in `src/search/documents.js` (pure, beside
  the other document-shape decisions), re-exported from `SearchService.js` and
  stamped as `doc.downloads` in `loadDocuments`. Deliberately outside the text
  view: URLs would be noise in the lexical index and would invalidate every
  stored embedding.
- The plugin page gained a Downloads row beside Platforms — one link per file,
  labelled with its stated systems, nothing where the sources published no
  asset. The same URLs ride in the JSON-LD (`schema.org/downloadUrl`), the
  negotiated Turtle (`schema:downloadUrl`, not `pu:` — that term belongs to a
  package file and this subject is the plugin), the generated `profile.ttl`,
  the plugin JSON, and the MCP `get_plugin` record.
- The profile half needed one judgement call: downloads are found facts, not
  told ones, so they are not `SUBMITTABLE` fields. The generated file carries
  them and a paste-back reports them as read-and-not-kept rather than dropping
  them silently — the same honesty the reader already extends to ports.

## Verification

- Core suite green (1418 tests then; two new files plus profile/MCP/serialise
  coverage), guards green, `loadDocuments` smoke-tested with a stub client,
  and the new query run against the local Fuseki: 1689 file rows.
- No new routes, config, vocabulary terms, or non-store persistence;
  `sparql/` ships in the image. The `.ttl` header comment claiming it is
  "everything the catalogue holds" was already an overstatement and left alone.

## Triage with it

INBOX.md emptied: the profile item here, the source-checking routine designed
into TODO.md §3's "Links rot" bullet (403 means unknown, timestamp wants its
own predicate, caution belongs in `trn:caution`), build warnings checked with
nothing to fix. HUMANS.md untouched — rollout is the standing deploy habit.

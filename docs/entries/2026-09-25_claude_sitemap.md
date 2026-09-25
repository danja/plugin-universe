# Claude : A sitemap, and the line that waited on it

2026-09-25. TODO.md §0 carried a sitemap whose decision was already taken
(HUMANS.md: `/`, `/plugins` and its pages, categories, plugins; `/search`
out) and whose `robots.txt` line waited on the file — pointing at a 404 being
the contact-page defect again. `tests/api/robots.test.js` even named the
assertion to change when the route arrived.

## What was built

- `src/api/sitemap.js` (new): a pure `buildSitemap` in the shape of the
  serialisations — XML by concatenation, not a template, since `templates/`
  holds the site's HTML. Page two onwards of `/plugins` as `?from=` offsets,
  first-seen dates as `lastmod` where recorded, none where absent.
- Mounted in `metaRoutes` (`path === '/sitemap.xml'`, in `PATHS`), built from
  the documents already in memory. Footer link in `site-links.html`, which is
  what the `linked-routes` guard's other direction requires; `robots.txt`
  gained the `Sitemap:` line.
- The robots assertion is now bound rather than present: it parses the
  `Sitemap:` URL and requires its path to be a route the router answers, via
  `isMetaPath` — so the line can never name a 404 again. `server-starts`
  answers it with 200 as XML, names a real plugin, excludes `/search`, and
  refuses its POST.

## Verification

- Core guards green (linked-routes both directions included); full
  `server-starts.test.js` green against the booted server with local Fuseki —
  47/47, which also proves the new module's imports, the exact failure class
  that test exists for. Along the way an edit briefly swallowed the profile
  test's opening line; caught by reading the region before moving on, which is
  the bulk-edit rule in CLAUDE.md working as intended.

## Triage with it

TODO.md §0 bullet closed into Done; the HUMANS.md sitemap decision struck
into Confirmed done. Still yours: deploy (`deploy.sh`, then `test:live`),
which is the standing habit, not a new step.

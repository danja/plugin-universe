# Inbox

Loose ideas, before they have a phase. Moved into [TODO.md](TODO.md) or
[HUMANS.md](HUMANS.md) once they do — this file is the inbox, not the record.

* **The `jig:` half of a JigDAW profile is not harvested.** `JigDawHarvester`
  reads the `trn:` and `lv2:` facts and deliberately leaves the module and
  processor locations, their SRI digests, `jig:renderQuantum`,
  `jig:latencyFrames` and the channel counts — real and useful facts, which
  nothing in `sparql/queries/` would select and no page would show. Writing them
  now would be the write path without the read path, which is the failure at the
  top of CLAUDE.md. When something wants them — a host that can load a plugin
  from the catalogue is the obvious candidate — the write is four lines in that
  harvester and the query, the document and the page are the work.

* **An external host capability has no label on a plugin page.** `trn:requires
  jig:MidiEvents` renders as "MidiEvents", because labels come from the filled
  submission field table and that only knows `trn:` terms. JigDAW's own
  vocabulary labels it "MIDI Events". Either the harvester writes labels for the
  capabilities it references into its own source graph and the page reads them
  back, or the page humanises a local name — the first is right and the second
  is cheap.

* **`/dumps/` is crawlable and large.** Deliberate for now: an open dataset
  should be findable. Worth revisiting if a crawler starts pulling the full
  dump repeatedly — a `Disallow: /dumps/` would hide it from search as well,
  which is the trade.

## Confirmed done

* ~~support JigDAW plugins : /home/danny/github/jigdaw~~ — `JigDawHarvester`,
  wired into `bin/ingest.js` behind `JIGDAW_PATH`, three plugins in the local
  store and searchable. Terms reviewed in `docs/sources.md` §4.
* ~~move this file to INBOX.md in the root dir and update references~~
* ~~move danja-todo.md to HUMANS.md in the root dir and update references~~ —
  `tests/api/doc-links.test.js` now fails on a link between documents that does
  not resolve, which is what would have caught the twenty-odd references.
* ~~check for any unintended CORS issues and any mistakes relating to blocking
  bots~~ — three CORS defects found and fixed, see MISTAKES.md 2026-09-18.
  Nothing blocks bots anywhere: `robots.txt` is permissive by design, no nginx
  or application rule matches on a user agent, and the AI-crawler stance is
  stated in the file rather than left to be inferred.

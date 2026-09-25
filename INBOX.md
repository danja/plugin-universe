# Inbox

Loose ideas, before they have a phase. Moved into [TODO.md](TODO.md) or
[HUMANS.md](HUMANS.md) once they do — this file is the inbox, not the record.

Empty as of 2026-09-25. Where the three items went:

* *Direct download links on the plugin profile, if available* — built: the
  Downloads row, JSON-LD, Turtle, `profile.ttl` and MCP record. See TODO.md
  Done 2026-09-25.
* *A source-checking routine with 404 cautions and a "source last checked"
  field* — designed, not built: folded into the "Links rot" bullet in TODO.md
  §3, with the 403-means-unknown constraint and the vocabulary notes.
* *Check builds for warning messages* — checked 2026-09-25: `npm test` is
  green with no Node warnings; the only stderr output is the suites'
  deliberate log lines (billing without a secret, auth refusals, sign-in
  disabled). Nothing to fix in the local codebase.

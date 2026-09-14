Curation decisions live here and are committed to git.

github-candidates.json is written by bin/discover.js and edited by hand: the
`include` flag on each row is a decision about a source, not a computed value.
Bind-mounted into the container so it is editable on the host.

vendor-merges.json is written entirely by hand and read by bin/mint-vendors.js.
It says which vendors are one maker under two names — "danja" and "Danny Ayers"
are the same person, and nothing derivable from those strings will ever say so.

Two things about it differ from the candidates file, and both matter:

  - **It cannot be regenerated.** discover.js can rewrite its candidates from
    GitHub at any time; nothing can rewrite this, because the knowledge is not
    in the data. If it is lost, it is lost.
  - **It must be reapplied on every derivation.** mint-vendors drops and
    rewrites the vendor graph whole, so a merge asserted directly against the
    store survives exactly until the next run. That is the reason this is a
    file rather than an UPDATE.

A merged-away vendor keeps its IRI, as an owl:sameAs pointing at the survivor:
those identifiers are published, dereference, and are in the CC0 dump, so they
have to keep answering. `why` and `decided` are part of the record — this file
is the only place the reasoning exists.

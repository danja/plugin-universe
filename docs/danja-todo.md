# Danja's list

Things only you can do: server access, credentials, legal, and the decisions
that are yours rather than mine. Everything here is written so it can be pasted.

`TODO.md` is what the *project* needs. This is what *you* need to do next.

**What I cannot see.** I have no access to the server. Anything below marked
*(believed done — confirm)* is inferred from what worked earlier in a session,
not from checking. The repository is at `/home/github/plugin-universe` on
`hyperdata`, and I have never read it.

---

## 1. Deploy the current work

Nothing in the working tree is committed. Review it first — there are new files
as well as changes, and the new tests are the part worth reading.

```sh
# locally
git status
git add -A && git commit        # your call on the message
git push
```

Then on the server. The app image copies `src/`, so it needs rebuilding; Fuseki
and nginx are untouched.

```sh
cd /home/github/plugin-universe
git pull
docker compose build app
docker compose up -d app
docker compose logs --tail=30 app
```

The log should say `Sign-in enabled`, `Contributions enabled`, and the plugin
count. If it says `Sign-in DISABLED`, the reason is printed on the same line.

- [ ] committed and pushed
- [ ] pulled, rebuilt, restarted
- [ ] `/health` still reports the corpus and `"signIn": "enabled"`

---

## 2. Refresh the data — this is the one that matters

Two of this session's changes do nothing until an ingest runs.

**The category scheme.** It went from 4 predicates to a full SKOS scheme with
definitions, synonyms and LV2 alignments — 337 triples. The synonyms are what
make "overdrive", "brickwall" and "reverberation" find the right plugins, and
they are written by the ingest, not by the deploy.

**First-seen dates.** `dcterms:created` is new. Until a run writes it, the
front-page listing has nothing to order by and falls back to alphabetical. The
first dated run stamps everything it writes with that run's time, so ordering
only becomes meaningful for plugins added *after* it. That is honest — nobody
knows when the existing 645 arrived — and it is why this is worth doing sooner
rather than later.

```sh
cd /home/github/plugin-universe
docker compose run --rm app node bin/ingest.js --only-new
docker compose restart app        # the app loads the index at start
```

`--only-new` embeds just the plugins with no vector yet, so this is minutes, not
the fifty-minute rebuild.

**Watch for two things in the output:**

- `N categories are in the data but not in vocabs/categories.ttl` — a warning,
  not an error. It means a category is being used that nothing defines. Tell me
  and I will write the concept.
- `source skipped, no checkout at /srv/seed/...` — then `SEED_DIR` is not
  pointing at the downspout and flues checkouts, and only the Open Audio Stack
  plugins get dates. Not fatal; the existing data is untouched. Set `SEED_DIR`
  in `.env` to the directory holding them and run it again.

Then check it worked:

```sh
curl -s https://plugin-universe.com/category/amp | grep -i "gain stage"
curl -s "https://plugin-universe.com/search?q=brickwall&limit=3" | head -30
```

The first should return the scope note about `lv2:AmplifierPlugin` being a false
friend. The second should return limiters.

- [ ] ingest run, output read rather than skimmed
- [ ] app restarted
- [ ] a synonym search returns the right plugins

---

## 3. Validate against the new shapes

The SHACL shapes gained rules this session — `dcterms:created`, `foaf:depiction`,
and six SKOS properties. Worth one run to prove the store still conforms.

```sh
docker compose run --rm app node bin/validate.js
```

- [ ] every graph conforms

---

## 4. The GitHub sweep

Built, tested, and never run at scale — this host's connection makes it
impractical, which is the whole reason it was left for the server.

```sh
cd /home/github/plugin-universe
docker compose run --rm app node bin/discover.js --merge
```

That writes `data/curation/github-candidates.json` and **ingests nothing**. It is
a bind mount, so you can read and edit it on the host. Review it:

- Only rows marked `include` are harvested.
- A repository with no recognised licence is listed and not included. That is
  policy ([resources.md §4](resources.md), rule 7) and needs no attention.
- What is worth your eye is whether anything obviously good was *missed* by the
  topic search. Worth seeding: the DISTRHO and MOD organisations, and any
  repository already named by a harvested plugin's `foaf:homepage`.

```sh
docker compose run --rm app node bin/ingest.js --github data/curation/github-candidates.json
docker compose restart app
```

Needs `GITHUB_TOKEN` in the server `.env` — see §5 first. Each repository gets
its own graph carrying its own licence.

- [ ] discovery run and the candidate file reviewed by a person
- [ ] sweep ingested
- [ ] `data/curation/github-candidates.json` committed, since it is a record of
      decisions you made

---

## 5. Credentials — do this before the sweep

**The harvesting token was exposed twice** in an earlier session: once by an IDE
selection putting it in the transcript, once by a `docker compose config` I ran
that printed the resolved environment. Both times it was the `GITHUB_TOKEN`.

- [ ] revoke the current token at https://github.com/settings/tokens
- [ ] issue a new one — **no scopes**, public repository metadata only
- [ ] update `.env` locally **and** on the server
- [ ] confirm nothing else in `.env` was in that output

The OAuth App client secret was not printed and does not need rotating unless
you would rather be sure.

---

## 6. Blockers — nothing moves until you decide

**Contributor terms need a lawyer.** `docs/contributor-terms.md` is the one
document in the repository with legal effect and it is currently one person's
plain-language statement of intent. The intent is settled; the wording is not
verified. **Until this is reviewed, do not advertise contributions to anyone but
yourself.** The machinery is complete and working — sign-in, corrections, the
moderation queue, trust promotion, rate limiting — so this is the only thing
between the current state and opening it up.

**`pluginval` is not installed anywhere.** It is a JUCE binary from Tracktion
covering VST/VST3/AU/LV2/LADSPA, and it is what would let the 46 built downspout
VST3s be measured at all. Without it Phase 2 reaches LV2 plugins only. Nothing
else in the profiler is waiting on anything.

---

## 7. Decisions that are yours

- **Plugin images.** 560 plugins now show a thumbnail, hotlinked from the Open
  Audio Stack registry's GitHub Pages site with a caption saying so. The
  alternative is caching them locally with a recorded source. Hotlinking is a
  request to someone else's server on every page view; caching is a copy of
  someone else's image. I picked hotlinking as the smaller imposition and made
  it lazy and referrer-free. Say if you would rather cache.
- **The public SPARQL endpoint's default graph.** On the deployed store a query
  with no `GRAPH` clause sees everything (`tdb2:unionDefaultGraph true`); the
  development store answers the same query with nothing. Nothing in the app is
  affected — every query names its graph, and a test now enforces that — but a
  stranger writing `SELECT * WHERE { ?s ?p ?o }` at `sparql.` gets everything or
  nothing depending on a setting they cannot see. Decide which, and publish the
  answer in the VoID description rather than leaving it to be discovered.
- **AUFX-O effect types.** The category scheme aligns to LV2 classes that I
  verified against the plugins installed here. AUFX-O equivalents for reverb,
  delay and so on are *not* asserted, because I could not check the published
  ontology. If you can open it, the missing alignments are an hour's work.

---

## 8. Confirm, when you are next on the server

These are believed done and I have no way to check.

- [ ] *(believed done — confirm)* DNS for `plugin-universe.com`, `www`, `api`,
      `sparql`, `mcp`
- [ ] *(believed done — confirm)* certificates issued and
      `docker compose --profile proxy up -d` running
- [ ] *(believed done — confirm)* `deploy/nginx/hyperdata-xmlns.conf` installed as
      a snippet and `include`d from the hyperdata.it server block

The IRI chain was verified working end to end earlier:

```sh
curl -sL -H "Accept: text/turtle" \
  http://purl.org/stuff/plugin-universe/plugin/wet-reverb-693085a0 | head -5
```

Turtle back means negotiation survived all the redirects. Worth re-running after
any nginx change.

Also worth a look while you are there:

```sh
docker compose run --rm app node bin/grant.js --list
```

`danja` should show as `moderator`. That is the only account, and the moderation
queue is reachable from the account bar in the header.

---

## Housekeeping, no hurry

- Two profiler scan graphs from test runs are still registered
  (`graph:profiler/lv2-scan-…`). Harmless, and they will be joined by real ones.
- The flues repository holds four copies of every bundle (source, build,
  staging, release). The harvester skips them; the repository would be tidier
  without them.
- Propose the `trn:` extensions upstream to `~/github/transmission` — in
  particular `trn:PluginFormat`, and retiring `trn:min`/`trn:minimum` in favour
  of the `lv2:` equivalents.

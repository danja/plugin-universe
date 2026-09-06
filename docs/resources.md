# Plugin Universe — Resources

Status: draft, 2026-09-06. Addresses the three items in [TODO.md](../TODO.md). Companion documents:
[Architecture](architecture.md), [Plan](plan.md), [Suggestions](suggestions.md).

---

## 1. Data sources

Each source is marked with its ingest status under the posture set out in
[architecture.md §8](architecture.md): **Permissive** (harvestable and redistributable),
**Own** (the user's own data), **Link-out only** (indexable later as name + URL, subject to review),
or **Excluded**.

### Own data — Phase 1 seed corpus

| Source | Contents | Status |
|---|---|---|
| `~/github/downspout` | 50 VST3 plugins, one `profile.ttl` each under `plugins/<slug>/` | Own |
| `~/github/flues` | 37 LV2 bundles, 88 `.ttl` files under `lv2/` | Own |
| `~/github/valis` | `profile.ttl` plus the `val:` element ontology and 15 circuit examples | Own |
| `~/github/transmission` | `vocabs/profile.ttl`, the consolidated `profiles/downspout.ttl` | Own |

### Open registries and structured sources

| Source | What it gives | Status |
|---|---|---|
| [open-audio-stack-registry](https://github.com/open-audio-stack/open-audio-stack-registry) | The live open plugin registry — YAML in git, generated JSON, REST-shaped paths. Shared standard between StudioRack and OwlPlug. The primary external source. | Permissive — **CC0-1.0** |
| [Open Audio Stack specification](https://github.com/open-audio-stack/open-audio-stack-registry/blob/main/specification.md) | The manifest schema the packaging layer is modelled on | Permissive |
| [studiorack-registry](https://github.com/studiorack/studiorack-registry) | Deprecated predecessor (last push 2024-11); useful for historical entries | Permissive — **MIT**, notice must be preserved |
| [OwlPlug](https://owlplug.com/) / [DropSnorz/OwlPlug](https://github.com/dropsnorz/OwlPlug) | Plugin manager consuming OAS registries; the integration target | GPL-3.0 — an integration target, not a data source |
| [webprofusion/OpenAudio](https://github.com/webprofusion/OpenAudio) | Curated list of open-source audio apps, plugins and libraries | Permissive — **CC0-1.0** |
| LV2 bundles in source repos | `manifest.ttl` + plugin `.ttl` — RDF by design, no scraping involved | Permissive — licence per repository, recorded per graph |
| DOAP files / GitHub API | Project metadata, releases, licences for open-source plugins | Permissive — **API only**, never HTML scraping; personal data restricted (§4) |
| [Wikidata](https://www.wikidata.org/wiki/Q4819876) | Notable plugins and vendors; useful for linking and disambiguation | Permissive (CC0) |
| Vendor submissions | Self-asserted, lands in `<graph:vendor/{id}>` | Permissive |
| User contributions | Lands in `<graph:user/{id}>` | Permissive |
| Profiler runs | Measured data generated in-house | Own |

### Third-party catalogues — link-out only, subject to review

Bulk harvesting these risks EU/UK sui generis database right and would make the corpus
unredistributable. They are listed as *later* link-out candidates, each requiring a terms-of-service
review first.

| Source | Notes |
|---|---|
| [KVR Audio product database](https://www.kvraudio.com/plugins/) | The incumbent. Largest catalogue; ~817 pages of listings. **Excluded** — see §4. |
| [Audio Plugins for Free](https://www.audiopluginsforfree.com/) | Freeware database with direct download links |
| [Free VST Hub](https://freevsthub.com/) | Links to original sources, hosts nothing itself |
| [Plugin Boutique](https://www.pluginboutique.com/) | Commercial storefront; affiliate terms may permit structured access |
| Third-party scraper APIs (e.g. parse.bot's KVR endpoint) | Do not use — a paid wrapper around a scrape does not resolve the underlying rights question |

---

## 2. Forums and communities

For research, for finding data, and eventually for promotion. Ordered roughly by relevance to this
project.

### Plugin development and DSP

| Forum | Why |
|---|---|
| [KVR — DSP and Plugin Development](https://www.kvraudio.com/forum/viewforum.php?f=33) | The centre of gravity for plugin developers |
| [KVR — Machine Learning and AI for Music Creation](https://www.kvraudio.com/forum/viewtopic.php?p=9290457) | Directly relevant to the AI-assisted-plugin-flood thesis; an active thread on AI-assisted plugin development communities |
| [JUCE forum](https://forum.juce.com/) | Framework-centric but the widest developer audience |
| [KVR Developer Challenge](https://www.kvraudio.com/kvr-developer-challenge/2026/) | Annual free-plugin competition — a concentrated source of new plugins and developers each year |
| [free-audio/clap CLAP community](https://github.com/free-audio/clap) | CLAP format development |
| [lv2 GitHub / mailing list](https://github.com/lv2/lv2) | LV2 specification and metadata practice |

### Producers and users

| Forum | Why |
|---|---|
| [KVR main forums](https://www.kvraudio.com/forum/) | The largest plugin-focused user community |
| [Gearspace](https://gearspace.com/) | Recording and gear, professional end |
| [Sound on Sound forum](https://www.soundonsound.com/forum) | Production principles, industry |
| [Linux Musicians](https://linuxmusicians.com/) | The LV2 and open-source audience; the natural early adopters for an open, queryable catalogue |
| r/audioengineering, r/vstplugins, r/edmproduction | Reddit reach; useful for launch signal |
| [Ardour](https://discourse.ardour.org/) and [Reaper](https://forum.cockos.com/) forums | DAW communities with strong plugin-management interest |
| [Bedroom Producers Blog](https://bedroomproducersblog.com/) | Free-plugin news; a discovery channel rather than a forum |

---

## 3. General resources

### Specifications and formats

- [LV2](https://lv2plug.in/) — RDF/Turtle plugin metadata; the model for the discovery layer.
  [Plugin guide](https://drobilla.net/files/lv2_plugin_guide/guide.html),
  [wiki](https://github.com/lv2/lv2/wiki)
- [CLAP](https://github.com/free-audio/clap) — MIT-licensed modern format, JSON-ish metadata
- [VST3 preset format](https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical+Documentation/Locations+Format/Preset+Format.html) — chunk-based binary with an XML MetaInfo chunk
- Audio Units — `Info.plist` `AudioComponents` entries
- A comparison of all four is in [perplexity.md](perplexity.md)

### Ontologies and vocabularies

- `trn:` profile vocabulary — the project's primary vocabulary, at
  `~/github/transmission/vocabs/profile.ttl`; spec in `~/github/transmission/docs/plugin-profiles.md`
- [AUFX-O — Audio Effect Ontology](http://isophonics.net/content/aufx) (Wilmering, Fazekas, Sandler,
  QMUL) — [source](https://github.com/muddymudskipper/aufx-o) (the QMUL-hosted `aufx.ttl` refuses
  automated fetches; take the ontology from the repo),
  [ISMIR 2013 paper](https://archives.ismir.net/ismir2013/paper/000041.pdf). The nearest prior art;
  the alignment target, not the primary vocabulary.
- Studio Ontology and the [Music Ontology](http://musicontology.com/) — AUFX-O's foundations
- Vamp Plugins Ontology — prior art for describing feature-extraction plugins in RDF
- [DOAP](https://en.wikipedia.org/wiki/DOAP), [FOAF](http://xmlns.com/foaf/spec/),
  [SKOS](https://www.w3.org/TR/skos-reference/), [PROV-O](https://www.w3.org/TR/prov-o/),
  [schema.org SoftwareApplication](https://schema.org/SoftwareApplication),
  [SPDX](https://spdx.org/licenses/)

### Tooling

- [pluginval](https://github.com/Tracktion/pluginval) — cross-platform validator, headless CLI mode;
  VST, VST3, AU, LV2, LADSPA
- [clap-validator](https://github.com/free-audio/clap-validator) — CLAP conformance
- [lv2bm](https://github.com/moddevices/lv2bm) — LV2 benchmark tool, JACK load percentage
- `lilv` / `lv2info` — LV2 metadata extraction without loading binaries
- [Apache Jena Fuseki](https://jena.apache.org/documentation/fuseki2/) — the triple store
- `faiss-node`, `hnswlib-node`, `sqlite-vec`, [Qdrant](https://qdrant.tech/) — vector index options
- `rdf-ext`, `rdf-parse`, `@rdfjs/namespace`, `@rdfjs/serializer-turtle` — the RDF toolchain in use
  across the user's repos
- [SHACL](https://www.w3.org/TR/shacl/) — validation shapes for the ingest pipeline

### Legal and compliance

- [Database protection in the EU](https://europa.eu/youreurope/business/running-business/intellectual-property/database-protection/index_en.htm)
  — sui generis right, 15-year term, "substantial part" extraction
- [UK database right guidance](https://www.lexisnexis.com/en-gb/legal/guidance/copyright-in-databases-database-right)
  — post-Brexit position
- CDPA s.29A — the UK text-and-data-mining exception; non-commercial research only
- [EU Digital Services Act](https://digital-strategy.ec.europa.eu/en/policies/digital-services-act) —
  ad labelling, ranking-parameter disclosure, ad repositories
- [ASA/CAP: recognising ads](https://www.asa.org.uk/advice-online/recognising-ads-advertisement-features.html)
  — disclosure must be immediate and prominent; "Sponsored" is advised against as ambiguous
- [Choose a License](https://choosealicense.com/appendix/) — the licence vocabulary the OAS
  specification adopts
- [CC0](https://creativecommons.org/publicdomain/zero/1.0/) — **the chosen dataset licence**;
  [Open Data Commons ODbL](https://opendatacommons.org/licenses/odbl/) was the rejected alternative

### Prior art worth reading

- [Wikipedia: LV2](https://en.wikipedia.org/wiki/LV2) and
  [audio plug-in](https://en.wikipedia.org/wiki/Audio_plug-in)
- [LWN: LV2](https://lwn.net/Articles/266147/) and [LWN: CLAP](https://lwn.net/Articles/893048/)

---

## 4. Source terms review

Reviewed 2026-09-06. Re-check before adding any source, and re-check existing sources annually —
licences and terms change, and a CC0 dataset can only be assembled from graphs whose terms still
permit it.

### The governing constraint

The published dataset is **CC0**. Individual facts are not copyrightable, but a *compilation* is —
and in the EU and UK a database additionally attracts the sui generis right, which protects against
extraction of a substantial part for 15 years regardless of whether the facts themselves are
protected. So the question for each source is never "are these facts free?" but "do this source's
terms permit re-publication of a substantial part of its compilation?"

Where the answer is no, the source is not thereby unusable — it is harvested into a graph flagged
non-redistributable, which the dump assembly excludes. Where the answer is yes but with conditions
(MIT, ISC), the notice travels with the graph.

### Findings

| Source | Terms as verified | Verdict |
|---|---|---|
| open-audio-stack-registry | **CC0-1.0** (GitHub licence metadata, 2026-09-06). Explicitly built as an open API for third-party integration: "an open API (static JSON) you can integrate into your own products". | **Clear.** CC0 in, CC0 out. No conditions, no notice, no analysis needed. The best external source by a distance. |
| webprofusion/OpenAudio | **CC0-1.0** | **Clear.** |
| studiorack-registry | **MIT** | **Usable.** MIT requires the copyright notice and permission text be preserved. Attach them as graph metadata; the facts extracted still flow into the CC0 dump, the notice travels with the graph. Deprecated and stale (2024) — historical entries only. |
| lv2/lv2 | **ISC** | Specification, not data. Vocabulary reuse is unrestricted in practice; the ISC notice applies to the spec files if redistributed. |
| LV2 bundles in the wild | Per repository — the plugin's own licence (flues is MIT) | **Check per repo at harvest.** Record the licence in the graph. Note that extracting factual metadata from a bundle is not redistributing the licensed work, but the bundle's own `doap:license` belongs in the graph regardless. |
| GitHub API | [Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies): "Scraping does not refer to the collection of information through our API." Prohibits using collected information "for spamming purposes... or selling personal information". | **Usable via the API only.** Never scrape GitHub HTML. Respect rate limits, authenticate. See the personal-data rule below. |
| Wikidata | **CC0** | **Clear.** Useful for vendor disambiguation and linking. |
| KVR Audio | No general terms-of-service page exists — the footer offers only a Privacy Statement and Marketplace T&Cs. `robots.txt` disallows only `/mailman/`, `/pipermail/`, `/forum/search.php`, `/auto/`, `/more/`, `/z/` and a few scripts, leaving `/plugins/` and `/product/` technically un-disallowed. However the site returns **403 to any non-browser client**, including a request with a browser user-agent string. | **Excluded.** Three independent reasons, any one sufficient: the sui generis right covers exactly this kind of curated catalogue and a CC0 re-publication would be an extraction of a substantial part; edge-level bot blocking is an access-control measure, and working around it is a worse problem than the one it solves; and the absence of a permissive term is not a permission. `robots.txt` permitting a path is not a licence to re-publish what is on it. If a relationship is ever wanted, the route is `contactus@kvraudio.com`. |
| Other third-party catalogues (Audio Plugins for Free, Free VST Hub, Plugin Boutique) | Not individually reviewed — none is a Phase 1 source | **Review before use.** Same analysis as KVR applies by default. |
| Third-party scraper APIs | — | **Excluded.** A paid wrapper around a scrape does not resolve the underlying rights question; it only adds a second set of terms. |

### Standing rules

1. **Licence flag on every graph, set at harvest time.** Dump assembly is a query over that flag, not
   a judgement call at publication time.
2. **API over scraping, always.** Where a source offers a sanctioned programmatic route, that route
   is the only one used. Where it does not, that silence is not consent.
3. **Never work around an access-control measure.** A 403, a rate limit, a bot check or a CAPTCHA is
   an answer.
4. **Personal data is not catalogue data.** DOAP `foaf:maintainer` entries and GitHub owner fields are
   personal data under GDPR, and GitHub's policies separately prohibit using collected information to
   sell personal information. Store a maintainer's public name and their role on the project; do not
   harvest email addresses; support erasure by graph. Registered users' own profiles are consented
   and are a separate matter.
5. **Link-out is not re-publication, but it is not a loophole either.** A name and a URL sufficient to
   send a user to the source is defensible; a name, a URL, a description, a screenshot and a price is
   the catalogue again under another name.
6. **When the terms are unclear, ask.** An email to a maintainer costs a day and settles the question
   permanently. Most open-source authors will say yes and be pleased to be asked.


# About the Plugin Universe crawler

If you are reading this because you saw this in your logs:

```
plugin-universe-harvester/0.1 (+https://plugin-universe.com/about/crawler)
```

— this page is what that link is for. It explains what the crawler does, how it
behaves, and how to make it stop.

**Maintainer:** Danny Ayers — danny.ayers@gmail.com

---

## What it is

Plugin Universe is an open, machine-readable catalogue of DAW plugins. The
factual data is public domain. The crawler collects plugin metadata — names,
formats, parameters, categories, licences, download links — so that people and
programs can search it.

See [About](about.md) for the project itself.

## What it does, and does not, fetch

**It uses documented APIs, and only those.** Where a source publishes an API,
that is the only route taken. Where a source does not, nothing is taken.

**It does not scrape HTML.** Not from sites with an API, and not from sites
without one. If you serve a web page and no API, this crawler has no interest in
it.

**It reads public data only.** No authentication is used beyond what a source
requires to lift its own rate limits, and no attempt is ever made to reach
anything that is not already public.

Currently it fetches from:

| Source | What |
|---|---|
| Open Audio Stack registry | one static JSON file, published for exactly this purpose |
| GitHub REST API | public repository metadata, and the contents of `.lv2` bundle files |

GitHub's acceptable use policies state that "scraping does not refer to the
collection of information through our API", and API collection is the only thing
done there.

## How it behaves

- **One request per second per host, one at a time.** No parallelism, no bursts.
- **Conditional requests.** Responses are cached with their ETag, and a repeat
  visit sends `If-None-Match`. Most re-harvests therefore cost you a `304` and
  no work at all.
- **A refusal is an answer.** A `401`, `403`, `404`, `410`, `429` or `451` stops
  the request and is reported. It is never retried behind a different user
  agent, a different address, or any other identity. If a rate limit publishes a
  reset time, the crawler waits for it, which is what the specification asks.
- **It identifies itself honestly**, with the user agent above and a working
  contact address.
- **It stores no personal data.** A maintainer's public name and their role on a
  project are catalogue data. Email addresses are not, and the crawler is
  deliberately configured so that it cannot read them — the GitHub token it uses
  is granted no scopes at all.

## How to make it stop

**Email danny.ayers@gmail.com and say so.** No justification needed, and it will
be done rather than discussed. You do not have to explain yourself to a robot's
owner.

Blocking the user agent also works and will be honoured as the answer it is.

The crawler is not a continuously running spider. It runs when a person starts
it, over a list of sources decided in advance and recorded in the repository, so
"stop" is a matter of removing a line rather than tuning a schedule.

## If something here is yours and should not be

Ask, and it will be removed. That applies to a description, a link, a name, or
an entire entry, whether or not you contributed it.

The project's posture is set out in full in
[the source terms review](resources.md); the short version is that it obeys the
law and tries to be a better neighbour than the law requires, and where those
two disagree the second one wins. Sources have been excluded on that basis
already.

## Contact

**danny.ayers@gmail.com**, and the other routes are on the
[contact page](/about/contact).

Email is the right one for anything about data removal or crawler behaviour. A
`robots.txt` rule will be honoured, but it will not say what went wrong —
if the crawler has been a nuisance, that is worth a sentence.

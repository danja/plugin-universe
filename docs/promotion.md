# Promoted listings

Some results in this catalogue are paid for. This page says exactly what that
buys, because a ranking effect nobody can inspect is one nobody can check.

## How you can tell

Every paid placement carries an **Ad** label, on the result itself and on the
plugin's own page. Not in a footnote, not on hover, not only on the search
page — wherever the listing appears, the label appears with it.

The label is "Ad" rather than "Sponsored" deliberately. The UK advertising
regulator advises against "sponsored" because readers understand it to mean
several different things, most of them not "someone paid for this".

## What it changes

Search here fuses two signals — how well your words match a plugin's name and
text, and how close your meaning is to what the plugin does. That produces a
score, and results are sorted by it.

A paid placement **multiplies that score by 1.25**, and nothing else.

Three things bound it, and one thing it deliberately does not do.

**It cannot put a plugin in a search it does not match.** Promotion is applied
after the search has finished, to the results the search already found. It
reorders them; it never adds one. A multiplier makes this structural rather
than a rule someone has to remember — anything multiplied by 1.25 is still
nothing.

**It does nothing at all for a weak match.** Scoring above zero is a low bar: a
single word in a description clears it. A placement only applies above a
relevance floor, so a promoted reverb stays absent from a search for "granular
synthesiser" instead of creeping up it.

**At most two paid placements appear on one page of results.**

And the thing it deliberately does not do: **reserve any position.** A
placement can come first, and it is labelled when it does.

That is a choice, and it is worth being plain about. A vendor paying for
placement expects to be seen, and a page that quietly capped them at third
would be selling something other than what was bought. What makes it
acceptable is the label and the two bounds above: a paid result at the top of a
list it genuinely belongs in is advertising doing what advertising does, and
you can see that it is one.

Being first is permitted rather than purchased, though. The boost is a
multiplier, so a substantially better match still wins — a promoted plugin
scoring 0.6 against a 1.4 match is lifted to 0.75 and stays second.

Browsing is not affected at all. `/plugins`, the category pages and the
alphabetical listings are unranked, so there is nothing there for money to
change, and it does not.

## The exact numbers

They are in the repository, in `config/preferences.js`, under
`PROMOTION_CONFIG`:

| Setting | Value | Meaning |
|---|---|---|
| `boostFactor` | 1.25 | multiplier on a promoted result's score |
| `floor` | 0.45 | how well it must already match before that applies |
| `maxPromotedRank` | 1 | the best position a placement can be lifted into |
| `maxPromotedPerPage` | 2 | paid placements per page of results |
| `termDays` | 365 | how long a placement runs |

Changing any of them changes what is written above, which is why they are one
list with one home rather than constants scattered through a sort function.

## What money does not buy

- **Facts.** A plugin's description, its formats, its measurements and its
  licence are what they are. A paid placement changes where a listing appears
  and nothing about what it says.
- **Removal of anything.** Promotion never hides, filters or downranks anybody
  else's plugin. It is a re-rank of results that were all going to be returned,
  and everything that would have been on the page is still on the page.
- **Measurements.** The profiler does not know what is promoted, and a verdict
  of `crashed` stays `crashed`.
- **Editorial.** Wiki pages are contributors' work under their own licence.

## How long it lasts

A year, and then it stops. Expiry is read from the record every time a search
runs, so a placement that has reached its date stops being applied immediately
— there is no scheduled job whose failure could leave an advertisement running
for free indefinitely.

A placement can also be ended early, which is recorded as the placement
stopping at that moment rather than as a separate status.

## The record

Every placement is stored as data: what was promoted, from when, until when,
and who authorised it. Promotions that have expired or been withdrawn are kept,
because a list of only what is running today answers none of the questions
worth asking about advertising.

## Why this page exists

Two sets of rules ask for it, and both are reasonable.

The EU Digital Services Act requires that advertisements be clearly
identifiable as such, that the reader be told on whose behalf, and that the
main parameters used to rank them be disclosed. The UK ASA and CAP rules
require disclosure that is immediate, prominent and understandable.

Building to that standard from the start costs almost nothing. Retrofitting it
after somebody complains costs a great deal, and by then the complaint is
already right.

If a placement here looks wrong to you — mislabelled, expired but still
showing, or ranking somewhere it should not — please
[say so](/about/contact). That is a defect, and it is one worth hearing about.

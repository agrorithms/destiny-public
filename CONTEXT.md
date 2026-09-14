# Destiny Farm Finder

Tracks Destiny 2 raid activity in near real time: which players are raiding right now, and who
has completed what. A set of background crawlers observes the Bungie API and writes to SQLite;
the web app only reads.

## Language

**Tracker**:
The live system: `data/raid-tracker.db`, the crawlers that fill it, and the leaderboards and
active sessions read off it. Always changing. Every unqualified term below is a Tracker term.
_Avoid_: the database, the app, production data

**Archive**:
A frozen, complete, read-only historical dataset served alongside the Tracker but never joined to
it. Complete means the crawl that produced it finished and will not run again; frozen means the
file is an artifact, built once and copied into place, never written by the app. The **GoS 10k**
(`data/gos-10k.db`) is the first and today the only one. An Archive has its own connection, its
own query module and its own senses of the terms below — where they differ, the entry says so.
_Avoid_: snapshot, historical database, the second DB

**Fireteam**:
A group of players playing a Destiny activity together. The unit users care about — every card on
the active-sessions page is one fireteam.
_Avoid_: party, group, team, squad, lobby

**Active Session**:
A fireteam observed to be inside a raid right now. Ceases to be active when the crawler confirms
the raid ended, or when the observation goes stale.
_Avoid_: live session, current activity, in-progress raid

**Roster**:
The players making up a fireteam, as reported by Bungie. May be incomplete — Bungie does not
always disclose every member — so a roster of one usually means limited visibility rather than a
genuine solo run.
_Avoid_: party members, participants, players in session (but see **Participant** (Archive))

**Tracked Player**:
A player the system knows about and will poll for activity. Identified by `Name#Code`; a player
becomes tracked by being discovered in a raid alongside someone already tracked.
_Avoid_: user, account, member

**Raid**:
Destiny's six-player endgame activity, and the only activity type the leaderboards and the
active-sessions list cover. Other activities are observed but never displayed.
_Avoid_: activity (too broad), instance

**Full Clear**:
A raid that began at the first encounter, as opposed to at a checkpoint, and reached the final
boss. Both halves are required, and each has its own signal: only Bungie's own report that the
activity began at the start establishes the first — no other signal is authoritative, and the
derived one that looked like it was had been wrong ever since Bungie stopped publishing the field
it read. The second means **at least one** player finished, not all of them, so a Full Clear can
contain players who did not finish it themselves. That is what separates it from a Completion,
which is about one particular player.

**In the Archive the first half cannot be established the same way**, because Bungie did not
populate its start-of-activity report for the whole of the history the GoS 10k covers. Zero runs
at or before **2022-02-21** carry the flag, so the Archive names two Full Clear rules and reports
which one it used:

- **Pinned Full Clear** — the flag after 2022-02-21, `starting_phase_index = 0` at or before it.
  Reconciles to exactly **10,000**, which is why it is the Archive's default. The pin instant is
  instance `10141395454`, the subject's *own last clear before a 40-day gap with no GoS runs* — it
  is where the evidence runs out, not a boundary Bungie chose, and the id means nothing else.
- **Disjunctive Full Clear** — flag set **or** phase index 0, anywhere in the history. **10,020.**
  Comparable to the Tracker, generous by 20 runs before the flag was reliable.

Both carry the second half — that the subject himself finished — inside the named rule rather than
leaving it to the caller. Dropping it returns 10,040 / 13,412: plausible-looking numbers that are
wrong. The pinned rule reads a stored column that already folds in "someone finished it", so its
gap is only 40 runs — the fireteam cleared them from the start without him. A 40-run error is
harder to notice than a 3,400-run one, not less wrong. See `src/lib/db/archive/queries.ts`.
_Avoid_: complete run, fresh run

**Checkpoint Run**:
A raid entered partway through, at a saved encounter. Observed and stored like any other run, but
never counted toward a leaderboard. The majority of raids we see.

**In the Archive the term barely applies**: there are **8** Checkpoint Runs in the entire GoS 10k
history. Any framing that contrasts clears with checkpoint farming is describing something this
dataset does not contain — the 3,352 Runs nobody finished were started from the beginning, not
entered at a checkpoint.
_Avoid_: partial run, CP run

**Completion**:
One full clear finished by a particular player, counted once per raid instance however many
characters they brought to it. The unit every leaderboard ranks by. A player being present for a
cleared raid is not enough — they must have finished it themselves.
_Avoid_: clear, kill, run

**Heartbeat**:
The crawler's periodic signal that it is still observing. Its age is the Data Freshness; once it
lapses, the site reports itself as no longer live.
_Avoid_: ping, health check, status

**Data Freshness**:
How long ago the crawler last confirmed it was working — the age of what the site knows. The only
freshness that says anything about whether a leaderboard or an active session can be trusted.
_Avoid_: last updated, uptime

**Page Freshness**:
How long ago a browser tab last fetched — the age of what is on screen. Says nothing about whether
the data behind it is current: a tab can be seconds old and still be displaying hours-old data.
_Avoid_: last updated, refresh time

**Farm**:
Repeatedly replaying a single raid encounter or checkpoint for rewards, rather than progressing
through the raid. The activity the site is named for.
_Avoid_: grind, rerun

**Run**:
In the Archive, one raid instance the subject entered — **not necessarily one he finished**. The
`completed` column says whether he did; `source` says which crawl found it
(`get_activity_history` was completions-only, `get_activity_history_unfiltered` added the 3,397 he
started and abandoned). A count of Runs is a count of attempts, and any question about *clears*
must say so with one of the Full Clear rules above.
_Avoid_: clear, raid, activity

**Clear Number**:
The ordinal of a Pinned Full Clear within an Archive, by `period` ascending: 1 for the first,
10,000 for the last. **Undefined for every other Run** — a Checkpoint Run, a Run nobody finished,
a Run the fireteam cleared without him, and a clear the Disjunctive rule counts but the Pinned
rule rejects all carry no Clear Number. It is a stored, indexed column written by the Archive build script
rather than something a query re-derives, because every panel on the analytics page inherits the
ranking and an ordinal eight call sites re-derive is one they can re-derive differently. See
ADR 0008.
_Avoid_: clear index, run number, rank

**Range** (Archive):
The window every panel on an Archive's page counts over, expressed either as dates or as Clear
Numbers. The two are **modes of one control, never combined**: Clear Number is defined by `period`
ascending, so a Clear Number range *is* a date range and ANDing them could only produce an empty
intersection. Both modes resolve to one pair of `period` bounds, which is what makes the two
expressions the same window rather than two filters kept in agreement. A Clear Number range
resolves to the exact instants of its first and last clear; a date range to whole UTC days, so
the dates a Clear Number range is displayed as are the days it *spans* and can hold a clear or
two either side of it.
_Avoid_: filter, window, date filter

**Degraded** (Archive range):
A range the URL asked for that selected no Runs at all — malformed, reversed, asking for both
modes, or naming clears or dates the Archive does not contain — and was therefore replaced by
the whole Archive, with the page saying so. Distinct from **clamping**, which is what happens to
a range that merely overruns the Archive: `clears 340–9999` against a 346-clear Archive is
trimmed to 340–346 and is *not* degraded, because it has a real answer. The distinction exists
because a page filtered to nothing reads as broken rather than as an answer.
_Avoid_: invalid, rejected, reset

**Milestone Preset**:
A named link into an Archive range — "the final thousand", "the first year" — from a committed
constant list, writing exactly the URL parameters manual selection writes. Every preset is
anchored to the Archive's own first and last Run, never to the current date: on a frozen dataset
a now-relative boundary drifts daily and eventually selects nothing, which renders as a broken
filter rather than as an error.
_Avoid_: shortcut, quick filter, season

**Helper**:
Anyone other than the Archive's subject who appears in one of his Runs, identified by `Name#Code`
like any other player. Named for what the dataset is about — the people who got him to 10,000 —
and deliberately not "teammate": a Helper is a fact about one player's history, not a symmetric
relationship, and someone who joined a checkpoint run he abandoned is still a Helper.
_Avoid_: teammate, fireteam member, participant (but see **Participant** (Archive))

**Player-Run**:
One player in one raid instance — the datum every population statistic is counted in. Distinct
from a Completion, which requires the run to be a finished Full Clear: a Player-Run counts whether
they cleared, joined at a checkpoint, or dropped out. A player who brought two characters to the
same instance is still one Player-Run, and today only their first-observed character's kills,
deaths and assists are kept.
_Avoid_: participant, entry, appearance (but see **Participant** (Archive))

**Participant** (Archive):
One of the distinct people who *entered* a given Run — the Archive's unit for "who was in this
raid", and deliberately not its Roster. A Run has as many Participants as there were distinct
memberships in it, so 430 of the 10,000 Pinned Full Clears have seven or more because people left
and were replaced; there is no way to recover a maximum-concurrent figure from this data and
inventing one was rejected. Always counted on `membership_id`, never on player rows: one person
who brought three characters is one Participant (hazard 1). Labelled in the UI as **people who
entered**, never as fireteam size.

The Tracker's **Roster**, **Helper** and **Player-Run** entries each list "participant" as a term
to avoid, and that still holds *for the Tracker* — a Roster is what Bungie reported a fireteam to
be, which is a different and weaker claim than who demonstrably entered. This term is the Archive's
alone, and it exists because the two databases genuinely mean different things here.

**Fastest Clear** (Archive):
A record in the Archive's fastest-clears list: a **Run**, ranked by `duration_seconds` ascending
within the active **Range**, scoped to Pinned Full Clears. Deliberately a Run rather than a player —
a board of players ranked by personal best puts the six people in the fastest Run into the top six
rows with identical times, a tie that says nothing, so the fireteam is the object being ranked.
Ties break on period ascending, then instance id, so two databases cannot order the same records
differently. A record renders its rank, duration, date and its **Clear Number** — the last is a
fourth field beyond what #91 asked for, kept on purpose so a row ties back to the **Range**
control in that control's own denomination, and confirmed by the user rather than left pending.

**Median Clear Duration** (Archive):
A **Helper**'s middle Pinned Full Clear time within the active **Range** — the statistic the
median speed board ranks on, and the answer to "who is reliably quick" as distinct from the
**Fastest Clear** list's "who set records". A median rather than a mean because this dataset
contains AFK runs of several hours, any one of which moves a mean by minutes and a median not at
all. Counted on distinct Runs, so a Helper who brought three characters to one raid contributes one
duration (hazard 1); an even clear count yields the mean of the two middle Runs and is therefore
legitimately fractional, rounded only when it is rendered.

A Helper appears on that board only above the **Clear Floor**: 15 Pinned Full Clears inside the
active Range, fixed rather than user-adjustable — this page is URL-driven server rendering, so a
slider is a full render per drag tick. Fifteen was measured, not picked: within clears 9,001–10,000
only 51 of the 725 Helpers present reach it and only 32 reach twenty-five, so a higher floor empties
the board on exactly the narrow filters it is most interesting on. The floor is stated in the
panel's own copy, because a floor a reader cannot see is indistinguishable from a missing Helper.
_Avoid_: average clear time, minimum runs, cutoff

**Presence** (Archive):
How much of the Archive a **Helper** was actually there for, measured in two ways the Helper
board renders side by side. **Runs present** is every **Run** in the active **Range** they
entered; **clears present** is how many of those are Pinned Full Clears. The two are different
numbers on purpose — presence and success are different things, and a board that collapsed them
into one column would hide the gap it exists to show. The board ranks on clears present, with
Runs present and then membership id breaking ties.
The subject has a presence too, and the presence strip measures it: his own interval in each
Pinned Full Clear — the same entry-to-exit envelope **Time Alongside** collapses him to — summed and
divided by those clears' summed duration. That is time weighted as time (91.55% unfiltered), not the
mean of each clear's own ratio (98.9%), which lets one long AFK Run count no more than a quick
clear. A **late join** is a clear he was in for under five minutes: 5 of the 10,000.
_Avoid_: appearances, attendance, runs together

**Time Alongside** (Archive):
The third reading of **Presence**: for each Pinned Full Clear, the overlap between a **Helper**'s
interval in that Run and the subject's, summed over the **Range** and rendered in hours. An
interval is derived per (Run, membership) from `start_seconds` and `time_played_seconds`, and both
sides are collapsed to a single envelope — earliest entry to latest exit — before the overlap is
taken. That collapse is hazard 1 wearing a third face: without it a player who brought two
characters to one raid has two overlapping intervals, the shared stretch is counted twice, and the
sum can exceed the total time either of them was in the Run at all. Its alternative reading,
**time in Run**, is that same envelope's own length summed over the same clears, whether or not he
was there for it — entry to exit, so for the few who brought two characters it includes the gap
between them, and the panel's copy says "entry to exit" rather than "total time played" for that
reason; the board offers both because the two barely differ across its top rows, which is
what makes the first one worth trusting. Both are computed in the query module, never in the page.
_Avoid_: time together, shared time, playtime

**Month Bucket** (Archive):
One calendar month of the Archive's history on the timeline, in UTC, holding that month's Pinned
Full Clears and the running total through the end of it. **Every month between the first Run and
the last is a bucket, including the ones holding nothing** — 8 of the production Archive's 75, and
48 of the fixture's 68. Omitting an empty month is the mistake the term exists to name: a `GROUP BY`
over the period returns only the months that hold a Run, and a chart drawn straight off it renders a
two-year pause as the gap between two adjacent bars, on an x-axis that is no longer proportional to
time and that looks entirely correct. Monthly rather than weekly (300+ unreadable bars) or yearly
(7 bars, which hide everything).
_Avoid_: month, bar, bin

**Shaded Band** (Archive):
The part of the timeline covering the active **Range**, drawn identically over both the cumulative
line and the monthly bars so it reads across the two. It is an annotation on the whole history
rather than a filter of it: the timeline is the one panel that does **not** narrow to the Range,
because a narrow filter with no context is how a reader loses the six-year arc the page is about.
Positioned within a month rather than snapped to one, and widened to a whole month when the Range
is narrower than that — a single day is a third of a pixel on a phone, and a band nobody can see is
indistinguishable from a filter that failed to apply.
_Avoid_: highlight, selection, overlay

**All Attempts**:
Every raid instance observed in a window, whatever became of it — Full Clears, Checkpoint Runs and
runs nobody finished. The counterpart to Full Clear, and the broader of the two scopes any
population statistic can be reported under.
_Avoid_: all runs, everything, unfiltered

**KDA Quartiles**:
The spread of KDA across a raid's Player-Runs: the 25th, 50th and 75th percentile of
`(kills + assists) / max(deaths, 1)`, each one a score some player actually achieved. Answers what
a typical player does in this raid, and how widely players differ. Every Player-Run counts once,
however active it was.
_Avoid_: average KDA, median KDA, KDA

**Aggregate KDA**:
A raid's or a player's combined kill economy: `(sum of kills + sum of assists) / sum of deaths`
across every Player-Run in scope. Weighted by activity — the busiest runs move it most — so it
answers what the population as a whole did, not what any one player is likely to do. Routinely
disagrees with the KDA Quartiles, and the disagreement is the point.
_Avoid_: average KDA, total KDA, KDA

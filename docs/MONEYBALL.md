# Moneyball

Ultimate frisbee player ratings, Madden-style: a shared roster, a sortable
table, and a card per player with a photo, an overall (OVR) and three category
scores, and a bar per stat. Every account with the `moneyball` feature rates
players independently on a 1-10 scale; the card shows the team average and
marks your own score.

## Stats

| Category | Stats |
|----------|-------|
| Offense  | Possession Handling, Huck Handling, Possession Cutting, Deep Cutting, Decision Making |
| Defense  | Handler Marking, Cutter Marking |
| General  | Verticality, Agility, Team Chemistry, Effort, Game IQ |

The catalog lives in `backend/src/moneyball/engine.ts` (`STATS`) and is
mirrored in `frontend/src/moneyball/stats.ts` for live preview. Adding a stat
is a code change to both files — the DB stores scores as jsonb so no migration
is needed.

### Rating guide

Every stat carries a `description` (the rubric a rater should apply) and the
catalog is accompanied by `RATING_GUIDE`, two general rules that apply to every
stat. Both are surfaced in the UI: hovering a stat label in the player card or
the Formula dialog shows its description, and the **Rating guide** toolbar
button (also "How to rate" while editing a rating) opens the full rubric.

General rules:

- Ratings are an **absolute scale, regardless of gender**. A player with a
  verticality rating of 8 should be a favorite to sky any player rated 7 or
  lower, regardless of gender.
- Rate **outcomes, not mechanics**. Forehand/backhand bias only matters insofar
  as it affects the actual skill: a backhand-dominant player who still throws
  breakside effectively (via cutting ability, release points, etc.) is not
  penalized for lacking a flick.

Per-stat rubric:

| Stat | Description |
|------|-------------|
| Possession Handling | Ability to execute all non-huck throws: in-cuts, strikes, dumps, swings, etc. |
| Huck Handling | Ability to throw deep hucks. |
| Possession Cutting | Ability to cut within the normal flow of an offense: in-cuts, strike cuts, sit-down cuts against zone, etc. |
| Deep Cutting | Ability to make and catch deep cuts. |
| Decision Making | As a handler, making good choices on when to throw and when to holster. As a cutter, understanding field space and positioning. |
| Handler Marking | Ability to mark on the disc and to mark and help off of an off-handler. In a zone, ability to play in the cup. |
| Cutter Marking | Ability to mark a cutter. |
| Verticality | Ability to play in the air: a combination of height, leaping ability, and timing. |
| Agility | Ability to move quickly and change directions quickly. Essentially speed plus quickness. |
| Team Chemistry | Non-playing impact on the team's morale. |
| Effort | Effort |
| Game IQ | Understanding of the state of the game (score/time); ability to identify and exploit strategic and tactical advantages. |

## Scoring

1. For each stat, take the mean across every rater who scored it (a rater may
   leave stats blank; blanks don't count).
2. OVR = weighted mean of those stat means using the shared weight table
   (default 1.0 each; weight 0 drops the stat). Category scores use the same
   weights restricted to that category's stats.
3. Rounded to one decimal. `null` when nothing contributes.

Weights are edited from the **Formula** button and stored in
`moneyball_settings` (key `weights`). They apply to everyone.

### Blind rating ("Hide until I rate")

The Players tab has a **Hide until I rate** switch, on by default, that masks
everyone else's ratings for players the viewer hasn't rated yet so their own
rating isn't anchored by the consensus. While a player is masked, the table
shows `–` for OVR/OFF/DEF/GEN (and sorts them as unrated so the order doesn't
leak scores), and the card hides the consensus badges, stat means, and the
rater chips behind an info banner with a **Rate player** shortcut. The rater
count stays visible. The preference is per browser (`localStorage`
`moneyball.hideUnrated`, see `frontend/src/moneyball/prefs.ts`); the API is
unaffected, and the Teams / Concentration tabs are aggregate views and are not
masked.

## Compare tab

`/moneyball/compare` (`CompareView.tsx`) is a calibration grid: every player as
a row, every stat as a column, showing **your own ratings only**. Click any
stat header to sort by it and scan down the column to check the ordering makes
sense; each cell has **−/+** buttons that nudge your score for that player by
one (pressing + on an unrated cell starts it at 5). Edits apply optimistically
(your OVR updates instantly using the shared weights) and are saved per player
via `PUT /moneyball/players/:id/rating` after a 600 ms debounce, so a run of
clicks becomes one request; pending saves are flushed when you leave the tab.
Hovering a value shows the consensus for that stat, unless the player is masked
by the "hide until I rate" preference. Filters: search, team, and "only players
I've rated". Clicking a player name opens their card on the Players tab.

## Teams tab

`GET /moneyball/teams` groups the board by `team` and runs `summarizeTeam`
(engine) on each:

- **Team scores** — the scorecard of the team's average player (mean of each
  stat's team mean, then the OVR formula).
- **Best players** — top 5 by OVR, with handler / cutter / defender role scores.
  Role scores are weighted means over role stat sets (`HANDLER_STATS`:
  possession handling, huck handling, decision making, game IQ; `CUTTER_STATS`:
  possession cutting, deep cutting, verticality, agility; `DEFENDER_STATS`: both
  markings, agility, verticality, effort).
- **Best offense line** — 4 handlers + 3 cutters, each player once, chosen by
  an exact DP that maximizes total role score (so a two-way star lands where
  the team gains most). Comes back `short` when fewer than 7 rated players.
- **Best defense line** — 7 best by defender score.
- **Stat leaders** — top player per stat.

Unrated players are excluded from everything except the player count.

## Concentration tab

Each `TeamSummary` also carries `concentration` — dispersion of rated players'
OVRs: min/max/range, p25/median/p75, standard deviation, top-7 mean vs bench
mean and their gap, and a Gini coefficient over (OVR − 1), where 0 is a
perfectly even roster and 1 is one player holding all the ability. The tab
shows a cross-team table (box plot per team, sorted by Gini), overlaid talent
curves (OVR by roster rank, one line per team) and a sorted OVR bar chart for
the selected team.

## Data model

- `moneyball_players` — shared roster, unique by `slug`. `photo_url` is a
  site-relative path served from `frontend/public/moneyball/players/`;
  `team` is the league team the player was imported from.
- `moneyball_ratings` — one row per (player, rater) with a jsonb `scores`
  object; upserted whole on save.
- `moneyball_settings` — key/value; only `weights` today.

## API (`/moneyball`, gated by the `moneyball` feature)

- `GET /moneyball/board` — players + team means + scores + your rating + weights
- `GET /moneyball/players/:id` — same plus per-rater breakdown
- `PUT /moneyball/players/:id/rating` `{ scores }` / `DELETE ...` — your rating
- `GET|PUT /moneyball/weights`

## Roster import

The roster is committed code (`backend/src/moneyball/roster.ts`) and upserted
into `moneyball_players` on every server boot, so adding players is: run the
import, commit, deploy.

The current roster came from Boise Ultimate Scene (Ultimate Central) team
pages saved with "Save page as" — one "Players on <Team>" page per team. The
importer reads every `.html` in a directory, takes each `a.media-item-tile`
(name from `<h3>`, photo from the CSS `background-image`, slug from the
`/u/<slug>` profile link) and the team name from `.team-show-header h1`.

```powershell
cd backend
# Preview what the scraper finds (writes nothing):
npx tsx src/moneyball/import.ts "C:\path\to\saved\team\pages" --dry-run
# Then for real: downloads photos to ../frontend/public/moneyball/players and rewrites roster.ts
npx tsx src/moneyball/import.ts "C:\path\to\saved\team\pages"
```

Sources can be files, directories, or URLs, mixed. Options: `--selector`,
`--name-selector`, `--img-selector`, `--team-selector` (or `--team <name>`)
when the defaults pick the wrong elements; `--base-url` for local files with
relative links; `--follow` when the page links out to one page per player
(name from `h1`/`og:title`, photo from `og:image`); `--keep` to retain existing
entries missing from the pages. Use `npx tsx` rather than
`npm run moneyball:import --` in PowerShell, which strips the `--`.

## Not yet

- Adding/editing players or photos from the UI (roster is import-only)
- Rating history over time
- Android

# Moneyball

Ultimate frisbee player ratings, Madden-style: a shared roster, a sortable
table, and a card per player with a photo, an overall (OVR) and three category
scores, and a bar per stat. Every account with the `moneyball` feature rates
players independently on a 1-10 scale; the card shows the team average and
marks your own score.

The card's **Raters** row is a selector: tapping a rater's chip swaps the
whole card (OVR, category badges, stat bars) to that person's individual
scores, with the thin marker then holding the team mean for comparison; the
**Team avg** chip (or tapping the selected rater again) returns to the
consensus. The per-rater data comes from `GET /moneyball/players/:id`, so this
respects the same masking as everything else — a player hidden by "Hide until
I rate" shows no rater chips at all.

**Layout by screen size:** at `md` and up the card is a sticky column beside
the table; below `md` it expands **in place**, inline under the tapped row
(tapping the row again collapses it), so picking a player on a phone never
means scrolling back to the top.

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

Weights are edited from the **Formulas** button and stored in
`moneyball_settings` (key `weights`). They apply to everyone.

### Role OVRs (handler / cutter / defender)

Every player also carries three role OVRs — **HND / CUT / DFD**. The Players
table's summary columns are exactly these plus the overall (OVR · HND · CUT ·
DFD, all sortable); the OFF/DEF/GEN category scores live on the card, which
also shows the roles as a badge row.
Each role has its own editable stat-weight table (any stat can feed any role;
weight 0 drops it), edited from the **Formulas** dialog's Handler / Cutter /
Defender tabs and stored in `moneyball_settings` (key `roleWeights`), shared
like the OVR weights. The defaults reproduce the historical fixed stat sets
(`HANDLER_STATS` / `CUTTER_STATS` / `DEFENDER_STATS`, weight 1 in-set, 0 out),
and the Teams tab's role panels rank by these same tables. On the card the
role badges follow whatever the card is showing — the consensus, one selected
rater's scores, or the live edit preview.

### Blind rating ("Hide until I rate")

The Players tab has a **Hide until I rate** switch, off by default, that masks
everyone else's ratings for players the viewer hasn't rated yet so their own
rating isn't anchored by the consensus. While a player is masked, the table
shows `–` for OVR/HND/CUT/DFD (and sorts them as unrated so the order doesn't
leak scores), and the card hides the consensus badges, stat means, and the
rater chips behind an info banner with a **Rate player** shortcut. The rater
count stays visible. The preference is per browser (`localStorage`
`moneyball.hideUnrated`, see `frontend/src/moneyball/prefs.ts`); the API is
unaffected, and the Teams / Concentration tabs are aggregate views and are not
masked.

Every player row on the Players and Compare tabs carries a gender designation:
the avatar is ringed and a small **M** / **W** tag (`GenderBadge.tsx`) sits
next to the name, blue for men and magenta for women (grey `?` when unset —
fix on the Roster tab). Both tabs have an Everyone / Men / Women filter
(`GenderFilter.tsx`). Colours live in `stats.ts` (`GENDER_COLOR`) and are the
same ones the Teams tab uses.

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
by the "hide until I rate" preference. Filters: search, team, gender, and "only
players I've rated". Clicking a player name opens their card on the Players tab.

## Teams tab

`GET /moneyball/teams` groups the board by `team` and runs `summarizeTeam`
(engine) on each:

- **Team scores** — the scorecard of the team's average player (mean of each
  stat's team mean, then the OVR formula).
- **Top handlers / cutters / defenders** — three panels ranking rated players
  by role score (top 7, expandable to all), each row colour-coded by gender
  (blue = man, magenta = woman, grey = unknown) with a per-panel M / W count.
  Role scores use the editable `roleWeights` tables (see "Role OVRs" above);
  the defaults are `HANDLER_STATS` (possession handling, huck handling,
  decision making, game IQ), `CUTTER_STATS` (possession cutting, deep cutting,
  verticality, agility) and `DEFENDER_STATS` (both markings, agility,
  verticality, effort). A player with none of a role's weighted stats rated is
  left out of that panel. Sorting and
  colouring happen client-side from `players[].roles` and `players[].gender`.
- **Stat leaders** — the top team-mean value per stat and every player tied at
  it (means are rounded to one decimal before comparing).

Unrated players are excluded from the team scores, role lists and leaders;
they appear as clickable chips in an "Unrated" panel (from `unrated[]`) and in
the player count. The team table's "M / W" column is the roster's gender split.

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
  site-relative path served from `frontend/public/moneyball/players/`, an
  https URL, or `s3:<key>` for an admin upload (see "Roster admin page");
  `team` is the league team the player was imported from; `gender` is `M`/`F`
  or null; `manually_edited` pins a row against the boot-time roster sync.
- `moneyball_ratings` — one row per (player, rater) with a jsonb `scores`
  object; upserted whole on save.
- `moneyball_settings` — key/value; `weights` (flat stat→weight) and
  `roleWeights` (role→stat→weight).

## API (`/moneyball`, gated by the `moneyball` feature)

- `GET /moneyball/board` — players + team means + scores + role OVRs + your
  rating + weights + roleWeights
- `GET /moneyball/players/:id` — same plus per-rater breakdown
- `PUT /moneyball/players/:id/rating` `{ scores }` / `DELETE ...` — your rating
- `GET|PUT /moneyball/weights` — `{ weights, roleWeights }` (`roleWeights`
  optional on PUT for older clients)

## Roster admin page

Admins (the account flag, not the Moneyball feature) get a **Roster** tab at
`/moneyball/roster` (`RosterAdminView.tsx`) for raw CRUD on
`moneyball_players`: every row including inactive ones, an edit dialog for
name / slug / team / gender / number / photo / active, an Add player form, an
Active toggle per row, and a permanent delete (cascades that player's
ratings). API: `GET|POST /admin/moneyball/players`,
`PATCH|DELETE /admin/moneyball/players/:id`,
`POST /admin/moneyball/players/:id/photo` (`routes/moneyballAdmin.ts`,
`moneyball/admin.ts`). The `/admin` prefix makes the auth middleware require
the admin flag.

**Interplay with the roster.ts sync.** Every write from this page sets
`manually_edited = true` on the row, and the boot-time `syncRosterFromCode`
skips flagged rows (`ON CONFLICT ... DO UPDATE ... WHERE manually_edited =
false`). So a fix made here sticks across deploys while untouched rows keep
following `roster.ts`. Two consequences: changing a slug means the sync will
re-insert the original slug from `roster.ts`, and hard-deleting a player who is
still in the file brings them back (unrated) on the next boot — mark them
inactive instead unless you also remove them from the file. Edited rows show
a "pinned" chip.

**Photos.** `photo_url` is one of: a site-relative path shipped with the
frontend by the importer (`/moneyball/players/x.jpg`), any https URL, or
`s3:<key>` for a photo uploaded from the Roster page. Uploads go as base64
JSON (jpeg/png/webp, ≤8 MB) to the private images bucket under
`moneyball/players/<slug>-<rand>.<ext>`; `photos.ts` resolves `s3:` refs to
6-hour presigned GET URLs wherever a player is served (board, detail, admin
list), so the rest of the app only ever sees a loadable URL. Locally this
needs AWS credentials for the images bucket (`AWS_PROFILE` in `.env`).

## Roster import

The roster is committed code (`backend/src/moneyball/roster.ts`) and upserted
into `moneyball_players` on every server boot, so adding players is: run the
import, commit, deploy.

The current roster came from Boise Ultimate Scene (Ultimate Central) team
pages saved with "Save page as" — one "Players on <Team>" page per team. The
importer reads every `.html` in a directory, takes each `a.media-item-tile`
(name from `<h3>`, photo from the CSS `background-image`, slug from the
`/u/<slug>` profile link) and the team name from `.team-show-header h1`.

**Gender** comes from the nearest preceding section heading: tiles under
`<h2>Women</h2>` are `F`, under `<h2>Men</h2>` are `M`. Ultimate Central lists
captains only under a separate `Captains` heading, so they come out with no
gender; the importer prints them at the end. Set `gender: "M" | "F"` on those
entries in `roster.ts` by hand (the importer keeps an existing hand-set gender
when the page doesn't provide one, so the fix survives re-imports) or fix them
on the Roster admin tab, which pins the row against the sync.

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

- Rating history over time
- Android

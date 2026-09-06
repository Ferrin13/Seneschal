# Moneyball

Ultimate frisbee player ratings, Madden-style: a shared roster, a sortable
table, and a card per player with a photo, an overall (OVR) and three category
scores, and a bar per stat. Every account with the `moneyball` feature rates
players independently on a 1-10 scale; the card shows the team average and
marks your own score.

## Stats

| Category | Stats |
|----------|-------|
| Offense  | Short Handling, Hucking Handling, Short Cutting, Deep Cutting, Decision Making |
| Defense  | Handler Marking, Cutter Marking |
| General  | Verticality, Agility, Team Chemistry, Effort, Game IQ |

The catalog lives in `backend/src/moneyball/engine.ts` (`STATS`) and is
mirrored in `frontend/src/moneyball/stats.ts` for live preview. Adding a stat
is a code change to both files — the DB stores scores as jsonb so no migration
is needed.

## Scoring

1. For each stat, take the mean across every rater who scored it (a rater may
   leave stats blank; blanks don't count).
2. OVR = weighted mean of those stat means using the shared weight table
   (default 1.0 each; weight 0 drops the stat). Category scores use the same
   weights restricted to that category's stats.
3. Rounded to one decimal. `null` when nothing contributes.

Weights are edited from the **Formula** button and stored in
`moneyball_settings` (key `weights`). They apply to everyone.

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

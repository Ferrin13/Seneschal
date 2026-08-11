import {
  Alert,
  Avatar,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import StarIcon from "@mui/icons-material/Star";
import LockIcon from "@mui/icons-material/Lock";
import { useMemo, useState } from "react";
import type {
  LeagueValues,
  PlayerValue,
  SeasonBoardPlayer,
  SeasonBoardTeam,
  ThrawnTeam,
} from "./types";
import {
  fmtPts,
  fmtPar,
  fmtVariance,
  keeperCount,
  positionColor,
  rosterValues,
  sleeperAvatarUrl,
  teamLabel,
} from "./format";
import { useSeasonBoard } from "./useSeasonBoard";
import { PlayerDetailDrawer } from "./PlayerDetailDrawer";

function PositionChip({ position }: { position: string | null }) {
  return (
    <Chip
      label={position ?? "?"}
      size="small"
      sx={{
        bgcolor: positionColor(position ?? ""),
        color: "#fff",
        fontWeight: 700,
        width: 44,
        height: 20,
        fontSize: "0.65rem",
      }}
    />
  );
}

function CurrentPlayerRow({
  v,
  declaredKeeper,
  onClick,
}: {
  v: PlayerValue;
  declaredKeeper: boolean;
  onClick: () => void;
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      onClick={onClick}
      sx={{
        px: 1,
        py: 0.4,
        borderRadius: 1,
        bgcolor: v.keeperLevel ? "rgba(102, 80, 164, 0.08)" : undefined,
        cursor: "pointer",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <PositionChip position={v.position} />
      <Typography
        variant="body2"
        noWrap
        sx={{ flexGrow: 1, fontWeight: v.keeperLevel ? 600 : 400 }}
      >
        {v.name}
      </Typography>
      {declaredKeeper ? (
        <Tooltip title="Declared keeper on Sleeper">
          <LockIcon sx={{ fontSize: 14, color: "text.secondary" }} />
        </Tooltip>
      ) : null}
      {v.keeperLevel ? (
        <Tooltip title={`Keeper level (#${v.keeperRank} league-wide by PAS)`}>
          <StarIcon sx={{ fontSize: 15, color: "#F9A825" }} />
        </Tooltip>
      ) : null}
      <Tooltip
        title={`PAS/G vs avg starter ${fmtPar(v.parStarter)} · PAR/G vs fringe bench ${fmtPar(v.par)} · year-to-year variance ${fmtVariance(v.parVariance)}`}
      >
        <Stack
          direction="row"
          spacing={0.75}
          sx={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
        >
          <Typography
            variant="body2"
            sx={{
              width: 40,
              textAlign: "right",
              color: v.parStarter > 0 ? "success.main" : "text.disabled",
              fontWeight: v.keeperLevel ? 700 : 400,
            }}
          >
            {fmtPar(v.parStarter)}
          </Typography>
          <Typography
            variant="body2"
            sx={{
              width: 40,
              textAlign: "right",
              color: v.par > 0 ? "success.main" : "text.disabled",
            }}
          >
            {fmtPar(v.par)}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ width: 34, textAlign: "right" }}
          >
            {fmtVariance(v.parVariance)}
          </Typography>
        </Stack>
      </Tooltip>
    </Stack>
  );
}

function SeasonPlayerRow({
  p,
  onClick,
}: {
  p: SeasonBoardPlayer;
  onClick: () => void;
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      onClick={onClick}
      sx={{
        px: 1,
        py: 0.4,
        borderRadius: 1,
        cursor: "pointer",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <PositionChip position={p.position} />
      <Typography variant="body2" noWrap sx={{ flexGrow: 1 }}>
        {p.name}
      </Typography>
      {p.gp > 0 ? (
        <Tooltip
          title={`PAS/G vs avg starter ${fmtPar(p.parStarter)} · PAR/G vs fringe bench ${fmtPar(p.par)} · ${fmtPts(p.points)} pts over ${p.gp} games`}
        >
          <Stack
            direction="row"
            spacing={0.75}
            sx={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
          >
            <Typography
              variant="body2"
              sx={{
                width: 40,
                textAlign: "right",
                fontWeight: 600,
                color: p.parStarter > 0 ? "success.main" : "text.disabled",
              }}
            >
              {fmtPar(p.parStarter)}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ width: 40, textAlign: "right" }}
            >
              {fmtPts(p.ppg)}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ width: 34, textAlign: "right" }}
            >
              {p.gp}g
            </Typography>
          </Stack>
        </Tooltip>
      ) : (
        <Typography variant="body2" color="text.disabled">
          did not play
        </Typography>
      )}
    </Stack>
  );
}

function seasonTeamLabel(t: SeasonBoardTeam): string {
  return t.teamName || t.displayName || `Roster ${t.rosterId}`;
}

/**
 * All teams side by side — a heat map of where the league's talent lives.
 * The season selector switches between today's rosters (projections) and
 * any past season's REAL rosters priced at that season's actual stats.
 */
export function LeagueBoard({
  leagueId,
  teams,
  valuation,
  league,
  rosterHistorySeasons,
}: Pick<LeagueValues, "teams" | "valuation" | "league" | "rosterHistorySeasons"> & {
  leagueId: string;
}) {
  const [season, setSeason] = useState<string>("current");
  const historical = season !== "current";
  const board = useSeasonBoard(leagueId, historical ? season : null);
  const [selected, setSelected] = useState<{
    playerId: string;
    name: string;
    position: string;
  } | null>(null);

  const valueById = useMemo(
    () => new Map(valuation.values.map((v) => [v.playerId, v])),
    [valuation.values]
  );
  const selectedValue = selected
    ? (valueById.get(selected.playerId) ?? null)
    : null;
  const ownerTeam =
    selectedValue?.rosterId != null
      ? teams.find((t: ThrawnTeam) => t.rosterId === selectedValue.rosterId)
      : undefined;

  const currentCards = useMemo(() => {
    return teams
      .map((team: ThrawnTeam) => ({
        team,
        values: rosterValues(valuation.values, team.rosterId),
        keepers: keeperCount(valuation.values, team.rosterId),
      }))
      .sort((a, b) => b.keepers - a.keepers);
  }, [teams, valuation.values]);

  const seasonCards = useMemo(() => {
    if (board == null || board === "loading" || board === "error") return [];
    return board.teams
      .map((team) => ({
        team,
        totalPas: team.players.reduce(
          (s, p) => s + (p.gp > 0 ? p.parStarter : 0),
          0
        ),
      }))
      .sort((a, b) => b.totalPas - a.totalPas);
  }, [board]);

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ sm: "center" }}
      >
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="board-season-label">Season</InputLabel>
          <Select
            labelId="board-season-label"
            label="Season"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
          >
            <MenuItem value="current">{league.season} (projections)</MenuItem>
            {rosterHistorySeasons.map((s) => (
              <MenuItem key={s} value={s}>
                {s} (actual)
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="body2" color="text.secondary">
          {historical ? (
            <>
              The {season} season as it happened: end-of-season rosters, each
              player priced by his actual {season} stats. The three numbers:
              per-game PAS vs. that season's league-average starter, actual
              points per game, and games played. Teams ordered by total PAS.
            </>
          ) : (
            <>
              Teams ordered by keeper-level talent (a player is keeper level
              when his PAS ranks inside the league's {valuation.keeperSlots}{" "}
              keeper slots, {league.settings.maxKeepers} per team, and his
              PAR/G is at least +{valuation.keeperMinPar.toFixed(1)} — below
              that he's trivially replaceable from waivers). The three
              numbers per player: per-game PAS vs. the league-average
              starter, per-game PAR vs. the fringe bench-level replacement,
              and year-to-year PAR variance.
            </>
          )}
        </Typography>
      </Stack>

      {historical && board === "loading" ? <CircularProgress /> : null}
      {historical && board === "error" ? (
        <Alert severity="error">Failed to load {season} rosters.</Alert>
      ) : null}
      {historical &&
      board != null &&
      board !== "loading" &&
      board !== "error" &&
      board.teams.length === 0 ? (
        <Alert severity="info">
          No roster history for {season} — press Sync to pull it from Sleeper.
        </Alert>
      ) : null}

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, 1fr)",
            md: "repeat(3, 1fr)",
            lg: "repeat(4, 1fr)",
            xl: "repeat(5, 1fr)",
          },
        }}
      >
        {!historical
          ? currentCards.map(({ team, values, keepers }) => {
              const declared = new Set(team.keepers);
              const isMe = league.myRosterId === team.rosterId;
              return (
                <Card
                  key={team.rosterId}
                  variant="outlined"
                  sx={
                    isMe
                      ? { borderColor: "secondary.main", borderWidth: 2 }
                      : undefined
                  }
                >
                  <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      sx={{ mb: 1 }}
                    >
                      <Avatar
                        src={sleeperAvatarUrl(team.avatar)}
                        sx={{ width: 28, height: 28 }}
                      >
                        {teamLabel(team).slice(0, 1)}
                      </Avatar>
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography
                          noWrap
                          sx={{ fontWeight: 600, lineHeight: 1.2 }}
                        >
                          {teamLabel(team)}
                          {isMe ? " (me)" : ""}
                        </Typography>
                        {team.displayName && team.teamName ? (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            noWrap
                          >
                            @{team.displayName}
                          </Typography>
                        ) : null}
                      </Box>
                      <Chip
                        size="small"
                        icon={<StarIcon sx={{ fontSize: 14 }} />}
                        label={keepers}
                        color={keepers === 0 ? "default" : "secondary"}
                        variant={keepers === 0 ? "outlined" : "filled"}
                      />
                    </Stack>
                    <Stack spacing={0.25}>
                      {values.slice(0, 12).map((v) => (
                        <CurrentPlayerRow
                          key={v.playerId}
                          v={v}
                          declaredKeeper={declared.has(v.playerId)}
                          onClick={() =>
                            setSelected({
                              playerId: v.playerId,
                              name: v.name,
                              position: v.position,
                            })
                          }
                        />
                      ))}
                      {values.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          No projected players.
                        </Typography>
                      ) : null}
                    </Stack>
                  </CardContent>
                </Card>
              );
            })
          : seasonCards.map(({ team }) => {
              const isMe =
                team.currentRosterId != null &&
                league.myRosterId === team.currentRosterId;
              return (
                <Card
                  key={team.rosterId}
                  variant="outlined"
                  sx={
                    isMe
                      ? { borderColor: "secondary.main", borderWidth: 2 }
                      : undefined
                  }
                >
                  <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      sx={{ mb: 1 }}
                    >
                      <Avatar
                        src={sleeperAvatarUrl(team.avatar)}
                        sx={{ width: 28, height: 28 }}
                      >
                        {seasonTeamLabel(team).slice(0, 1)}
                      </Avatar>
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography
                          noWrap
                          sx={{ fontWeight: 600, lineHeight: 1.2 }}
                        >
                          {seasonTeamLabel(team)}
                          {isMe ? " (me)" : ""}
                        </Typography>
                        {team.displayName && team.teamName ? (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            noWrap
                          >
                            @{team.displayName}
                          </Typography>
                        ) : null}
                      </Box>
                      {team.currentRosterId == null ? (
                        <Chip size="small" variant="outlined" label="left league" />
                      ) : null}
                    </Stack>
                    <Stack spacing={0.25}>
                      {team.players.slice(0, 14).map((p) => (
                        <SeasonPlayerRow
                          key={p.playerId}
                          p={p}
                          onClick={() =>
                            setSelected({
                              playerId: p.playerId,
                              name: p.name,
                              position: p.position ?? "",
                            })
                          }
                        />
                      ))}
                      {team.players.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          No players.
                        </Typography>
                      ) : null}
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}
      </Box>

      <PlayerDetailDrawer
        open={selected != null}
        onClose={() => setSelected(null)}
        leagueId={leagueId}
        player={selectedValue}
        fallback={selected}
        teamName={ownerTeam ? teamLabel(ownerTeam) : null}
      />
    </Stack>
  );
}

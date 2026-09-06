import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { MONEYBALL_PATH, MoneyballTabs } from "./MoneyballTabs";
import { ScoreBadge } from "./ScoreBadge";
import {
  CATEGORIES,
  CATEGORY_ABBR,
  CATEGORY_LABELS,
  MAX_SCORE,
  STATS,
  fmtScore,
  scoreTone,
  statsInCategory,
} from "./stats";
import type { Line, LineSlot, RankedPlayer, TeamSummary } from "./types";

const TONE_COLOR: Record<ReturnType<typeof scoreTone>, string> = {
  success: "success.main",
  info: "info.main",
  warning: "warning.main",
  error: "error.main",
  default: "grey.400",
};

const hideOnMobile = { display: { xs: "none", sm: "table-cell" } } as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Typography variant="overline" sx={{ fontWeight: 700, letterSpacing: 1.5 }}>
      {children}
    </Typography>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <Stack
      spacing={1.5}
      sx={{
        p: 2,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 2,
        bgcolor: "background.paper",
      }}
    >
      {children}
    </Stack>
  );
}

/** Compact player row: avatar, name, trailing value. Click opens the card. */
function PlayerRow({
  playerId,
  name,
  photoUrl,
  trailing,
  secondary,
}: {
  playerId: string;
  name: string;
  photoUrl: string | null;
  trailing: ReactNode;
  secondary?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.5}
      onClick={() => navigate(`${MONEYBALL_PATH}/${playerId}`)}
      sx={{
        cursor: "pointer",
        borderRadius: 1,
        px: 0.5,
        py: 0.25,
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Avatar
        src={photoUrl ?? undefined}
        alt={name}
        variant="rounded"
        sx={{ width: 32, height: 32, fontSize: 13 }}
      >
        {initials(name)}
      </Avatar>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
          {name}
        </Typography>
        {secondary ? (
          <Typography variant="caption" color="text.secondary" noWrap display="block">
            {secondary}
          </Typography>
        ) : null}
      </Box>
      {trailing}
    </Stack>
  );
}

function BestPlayers({ players }: { players: RankedPlayer[] }) {
  return (
    <Panel>
      <SectionTitle>Best players</SectionTitle>
      {players.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Nobody on this team has been rated yet.
        </Typography>
      ) : (
        players.map((p, i) => (
          <Stack key={p.playerId} direction="row" alignItems="center" spacing={1}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ width: 16, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
            >
              {i + 1}
            </Typography>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <PlayerRow
                playerId={p.playerId}
                name={p.name}
                photoUrl={p.photoUrl}
                secondary={`H ${fmtScore(p.roles.handler)} · C ${fmtScore(p.roles.cutter)} · D ${fmtScore(
                  p.roles.defender
                )}`}
                trailing={<ScoreBadge value={p.scores.overall} size="sm" />}
              />
            </Box>
          </Stack>
        ))
      )}
    </Panel>
  );
}

function LineGroup({ title, slots }: { title: string; slots: LineSlot[] }) {
  if (slots.length === 0) return null;
  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      {slots.map((s) => (
        <PlayerRow
          key={s.playerId}
          playerId={s.playerId}
          name={s.name}
          photoUrl={s.photoUrl}
          secondary={`OVR ${fmtScore(s.overall)}`}
          trailing={
            <Chip
              size="small"
              label={fmtScore(s.score)}
              color={scoreTone(s.score) === "default" ? "default" : scoreTone(s.score)}
              sx={{ fontWeight: 700, minWidth: 44 }}
            />
          }
        />
      ))}
    </Stack>
  );
}

function LinePanel({
  title,
  hint,
  line,
  splitRoles,
}: {
  title: string;
  hint: string;
  line: Line;
  splitRoles: boolean;
}) {
  const handlers = line.slots.filter((s) => s.role === "handler");
  const cutters = line.slots.filter((s) => s.role === "cutter");
  return (
    <Panel>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Tooltip title={hint} placement="top">
          <Box>
            <SectionTitle>{title}</SectionTitle>
          </Box>
        </Tooltip>
        <Chip
          size="small"
          label={`line ${fmtScore(line.score)}`}
          color={scoreTone(line.score) === "default" ? "default" : scoreTone(line.score)}
          variant="outlined"
          sx={{ fontWeight: 700 }}
        />
      </Stack>
      {line.slots.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Not enough rated players.
        </Typography>
      ) : splitRoles ? (
        <>
          <LineGroup title={`Handlers (${handlers.length})`} slots={handlers} />
          <LineGroup title={`Cutters (${cutters.length})`} slots={cutters} />
        </>
      ) : (
        <LineGroup title={`On the field (${line.slots.length})`} slots={line.slots} />
      )}
      {line.short ? (
        <Typography variant="caption" color="text.secondary">
          Short line: rate more players to fill it.
        </Typography>
      ) : null}
    </Panel>
  );
}

function TeamAverages({ team }: { team: TeamSummary }) {
  return (
    <Panel>
      <SectionTitle>Team average by stat</SectionTitle>
      {CATEGORIES.map((c) => (
        <Stack key={c} spacing={0.75}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
              {CATEGORY_LABELS[c]}
            </Typography>
            <Chip
              size="small"
              label={fmtScore(team.scores[c])}
              color={scoreTone(team.scores[c]) === "default" ? "default" : scoreTone(team.scores[c])}
              sx={{ fontWeight: 700 }}
            />
          </Stack>
          {statsInCategory(c).map((s) => {
            const v = team.stats[s.key];
            return (
              <Stack key={s.key} direction="row" alignItems="center" spacing={1.5}>
                <Typography variant="body2" sx={{ width: 140, flexShrink: 0 }}>
                  {s.label}
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={v == null ? 0 : (v / MAX_SCORE) * 100}
                  sx={{
                    flexGrow: 1,
                    height: 8,
                    borderRadius: 4,
                    bgcolor: "action.hover",
                    "& .MuiLinearProgress-bar": {
                      bgcolor: TONE_COLOR[scoreTone(v)],
                      borderRadius: 4,
                    },
                  }}
                />
                <Typography
                  variant="body2"
                  sx={{ width: 32, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
                >
                  {fmtScore(v)}
                </Typography>
              </Stack>
            );
          })}
        </Stack>
      ))}
    </Panel>
  );
}

function StatLeaders({ team }: { team: TeamSummary }) {
  const navigate = useNavigate();
  const byStat = new Map(team.leaders.map((l) => [l.stat, l]));
  return (
    <Panel>
      <SectionTitle>Stat leaders</SectionTitle>
      {team.leaders.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No ratings yet.
        </Typography>
      ) : (
        <Table size="small">
          <TableBody>
            {STATS.map((s) => {
              const l = byStat.get(s.key);
              return (
                <TableRow
                  key={s.key}
                  hover={!!l}
                  onClick={() => l && navigate(`${MONEYBALL_PATH}/${l.playerId}`)}
                  sx={{ cursor: l ? "pointer" : "default" }}
                >
                  <TableCell sx={{ pl: 0, width: 140 }}>{s.label}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{l?.name ?? "–"}</TableCell>
                  <TableCell align="right" sx={{ pr: 0, fontVariantNumeric: "tabular-nums" }}>
                    {l ? fmtScore(l.value) : "–"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

/**
 * Teams sub-tab: a comparison table of every team, then a detail panel for the
 * selected one — best players, best offense and defense lines, average by
 * stat, and per-stat leaders. All numbers come from GET /moneyball/teams.
 */
export function TeamsView() {
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const res = await api.moneyballTeams();
      setTeams(res.teams);
      setSelectedName((cur) => cur ?? res.teams[0]?.team ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load teams");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selected = teams?.find((t) => t.team === selectedName) ?? teams?.[0] ?? null;

  return (
    <Stack spacing={2}>
      <MoneyballTabs value="teams" />
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          Teams
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Team scores are the average player's card. Lines are the best 4 handlers + 3
          cutters (offense) and the 7 best defenders (defense), each player used once.
        </Typography>
      </Box>

      {loading ? (
        <Stack alignItems="center" sx={{ mt: 8 }}>
          <CircularProgress />
        </Stack>
      ) : null}

      {error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {teams && teams.length === 0 ? (
        <Alert severity="info">No teams yet. Import a roster with team pages first.</Alert>
      ) : null}

      {teams && teams.length > 0 ? (
        <TableContainer
          sx={{
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            bgcolor: "background.paper",
          }}
        >
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Team</TableCell>
                <TableCell align="center">OVR</TableCell>
                {CATEGORIES.map((c) => (
                  <TableCell key={c} align="center">
                    {CATEGORY_ABBR[c]}
                  </TableCell>
                ))}
                <TableCell align="center" sx={hideOnMobile}>
                  <Tooltip title="Average role score of the best offense line">
                    <span>O-line</span>
                  </Tooltip>
                </TableCell>
                <TableCell align="center" sx={hideOnMobile}>
                  <Tooltip title="Average defender score of the best defense line">
                    <span>D-line</span>
                  </Tooltip>
                </TableCell>
                <TableCell align="right" sx={hideOnMobile}>
                  Rated
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {teams.map((t) => (
                <TableRow
                  key={t.team}
                  hover
                  selected={selected?.team === t.team}
                  onClick={() => setSelectedName(t.team)}
                  sx={{ cursor: "pointer" }}
                >
                  <TableCell sx={{ fontWeight: 600 }}>{t.team}</TableCell>
                  <TableCell align="center">
                    <ScoreBadge value={t.scores.overall} size="sm" />
                  </TableCell>
                  {CATEGORIES.map((c) => (
                    <TableCell key={c} align="center" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      {fmtScore(t.scores[c])}
                    </TableCell>
                  ))}
                  <TableCell align="center" sx={{ ...hideOnMobile, fontVariantNumeric: "tabular-nums" }}>
                    {fmtScore(t.offenseLine.score)}
                  </TableCell>
                  <TableCell align="center" sx={{ ...hideOnMobile, fontVariantNumeric: "tabular-nums" }}>
                    {fmtScore(t.defenseLine.score)}
                  </TableCell>
                  <TableCell align="right" sx={{ ...hideOnMobile, fontVariantNumeric: "tabular-nums" }}>
                    {t.ratedCount}/{t.playerCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}

      {selected ? (
        <Stack spacing={2}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            alignItems={{ xs: "flex-start", sm: "center" }}
            sx={{
              p: 2,
              borderRadius: 2,
              color: "common.white",
              background:
                "linear-gradient(160deg, #1f1147 0%, #3b2a7a 55%, #5b46b8 100%)",
            }}
          >
            <ScoreBadge value={selected.scores.overall} label="OVR" size="lg" />
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
                {selected.team}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.8 }}>
                {selected.ratedCount} of {selected.playerCount} players rated
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              {CATEGORIES.map((c) => (
                <ScoreBadge key={c} value={selected.scores[c]} label={CATEGORY_ABBR[c]} size="sm" />
              ))}
            </Stack>
          </Stack>

          <Box
            sx={{
              display: "grid",
              gap: 2,
              alignItems: "start",
              gridTemplateColumns: { xs: "1fr", md: "1fr 1fr", lg: "1fr 1fr 1fr" },
            }}
          >
            <Stack spacing={2}>
              <BestPlayers players={selected.bestPlayers} />
              <StatLeaders team={selected} />
            </Stack>
            <Stack spacing={2}>
              <LinePanel
                title="Best offense line"
                hint="4 handlers by throwing/decision/IQ score, 3 cutters by cutting/athleticism score; assignment maximizes the total."
                line={selected.offenseLine}
                splitRoles
              />
              <LinePanel
                title="Best defense line"
                hint="7 best by marking, agility, verticality and effort."
                line={selected.defenseLine}
                splitRoles={false}
              />
            </Stack>
            <TeamAverages team={selected} />
          </Box>
        </Stack>
      ) : null}
    </Stack>
  );
}

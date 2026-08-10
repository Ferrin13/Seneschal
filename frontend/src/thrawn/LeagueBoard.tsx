import {
  Avatar,
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import StarIcon from "@mui/icons-material/Star";
import LockIcon from "@mui/icons-material/Lock";
import type { LeagueValues, PlayerValue, ThrawnTeam } from "./types";
import {
  fmtVar,
  keeperCount,
  positionColor,
  rosterValues,
  sleeperAvatarUrl,
  teamLabel,
} from "./format";

function PlayerRow({ v, declaredKeeper }: { v: PlayerValue; declaredKeeper: boolean }) {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      sx={{
        px: 1,
        py: 0.4,
        borderRadius: 1,
        bgcolor: v.keeperLevel ? "rgba(102, 80, 164, 0.08)" : undefined,
      }}
    >
      <Chip
        label={v.position}
        size="small"
        sx={{
          bgcolor: positionColor(v.position),
          color: "#fff",
          fontWeight: 700,
          width: 44,
          height: 20,
          fontSize: "0.65rem",
        }}
      />
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
        <Tooltip title={`Keeper level (#${v.keeperRank} league-wide by VAR)`}>
          <StarIcon sx={{ fontSize: 15, color: "#F9A825" }} />
        </Tooltip>
      ) : null}
      <Typography
        variant="body2"
        sx={{
          width: 52,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          color: v.var > 0 ? "success.main" : "text.disabled",
          fontWeight: v.keeperLevel ? 700 : 400,
        }}
      >
        {fmtVar(v.var)}
      </Typography>
    </Stack>
  );
}

/**
 * All teams side by side, players sorted by VAR, keeper-level players
 * highlighted — a heat map of where the league's keeper talent lives.
 */
export function LeagueBoard({
  teams,
  valuation,
  league,
}: Pick<LeagueValues, "teams" | "valuation" | "league">) {
  const sorted = [...teams].sort(
    (a, b) =>
      keeperCount(valuation.values, b.rosterId) -
      keeperCount(valuation.values, a.rosterId)
  );

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Teams ordered by keeper-level talent. A player is keeper level when his
        value above replacement ranks inside the league's{" "}
        {valuation.keeperSlots} keeper slots ({league.settings.maxKeepers} per
        team). Numbers are VAR: projected points above the replacement player
        at the position.
      </Typography>
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
        {sorted.map((team: ThrawnTeam) => {
          const values = rosterValues(valuation.values, team.rosterId);
          const keepers = values.filter((v) => v.keeperLevel).length;
          const declared = new Set(team.keepers);
          const isMe = league.myRosterId === team.rosterId;
          return (
            <Card
              key={team.rosterId}
              variant="outlined"
              sx={isMe ? { borderColor: "secondary.main", borderWidth: 2 } : undefined}
            >
              <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                  <Avatar
                    src={sleeperAvatarUrl(team.avatar)}
                    sx={{ width: 28, height: 28 }}
                  >
                    {teamLabel(team).slice(0, 1)}
                  </Avatar>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography noWrap sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                      {teamLabel(team)}
                      {isMe ? " (me)" : ""}
                    </Typography>
                    {team.displayName && team.teamName ? (
                      <Typography variant="caption" color="text.secondary" noWrap>
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
                    <PlayerRow
                      key={v.playerId}
                      v={v}
                      declaredKeeper={declared.has(v.playerId)}
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
        })}
      </Box>
    </Stack>
  );
}

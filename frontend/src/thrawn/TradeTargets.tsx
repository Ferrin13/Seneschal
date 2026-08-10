import {
  Alert,
  Avatar,
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import StarIcon from "@mui/icons-material/Star";
import type { LeagueValues, PlayerValue } from "./types";
import {
  fmtVar,
  positionColor,
  rosterValues,
  sleeperAvatarUrl,
  teamLabel,
} from "./format";

function PlayerChipRow({ v }: { v: PlayerValue }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
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
      <Typography variant="body2" noWrap sx={{ flexGrow: 1 }}>
        {v.name}
      </Typography>
      {v.keeperLevel ? <StarIcon sx={{ fontSize: 14, color: "#F9A825" }} /> : null}
      <Typography
        variant="body2"
        sx={{
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
          color: v.var > 0 ? "success.main" : "text.disabled",
        }}
      >
        {fmtVar(v.var)}
      </Typography>
    </Stack>
  );
}

/**
 * Who should I be trading with? Ranks the other teams by how starved they
 * are for keeper-level talent (most open keeper slots first) and lays your
 * surplus keepers next to what they could send back.
 */
export function TradeTargets({
  teams,
  valuation,
  league,
}: Pick<LeagueValues, "teams" | "valuation" | "league">) {
  const { maxKeepers } = league.settings;

  if (league.myRosterId == null) {
    return (
      <Alert severity="info">
        Pick your team in the "My team" selector above to see trade targets.
      </Alert>
    );
  }

  const myValues = rosterValues(valuation.values, league.myRosterId);
  const myKeepers = myValues.filter((v) => v.keeperLevel);
  const surplus = myKeepers.slice(maxKeepers);
  const myTeam = teams.find((t) => t.rosterId === league.myRosterId);

  const others = teams
    .filter((t) => t.rosterId !== league.myRosterId)
    .map((t) => {
      const values = rosterValues(valuation.values, t.rosterId);
      const keepers = values.filter((v) => v.keeperLevel);
      return {
        team: t,
        values,
        keepers,
        openSlots: Math.max(0, maxKeepers - keepers.length),
        // What they'd realistically send back: their best players. Keeper-level
        // ones first (they can't keep them all if over the limit), then the
        // best of the rest.
        assets: values.slice(0, 6),
      };
    })
    .sort(
      (a, b) =>
        b.openSlots - a.openSlots ||
        // Tie-break: weaker keeper haul first.
        a.keepers.reduce((s, v) => s + v.var, 0) -
          b.keepers.reduce((s, v) => s + v.var, 0)
    );

  return (
    <Stack spacing={2.5}>
      <Card variant="outlined" sx={{ borderColor: "secondary.main" }}>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>
            Your keeper situation{myTeam ? ` — ${teamLabel(myTeam)}` : ""}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            You have {myKeepers.length} keeper-level players for {maxKeepers}{" "}
            slots.{" "}
            {surplus.length > 0
              ? `That's ${surplus.length} more than you can keep — trade bait.`
              : "No surplus to shop right now."}
          </Typography>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={3}
            divider={<Divider orientation="vertical" flexItem />}
          >
            <Box sx={{ flex: 1 }}>
              <Typography variant="overline" color="text.secondary">
                Likely keeps
              </Typography>
              <Stack spacing={0.5}>
                {myKeepers.slice(0, maxKeepers).map((v) => (
                  <PlayerChipRow key={v.playerId} v={v} />
                ))}
              </Stack>
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="overline" color="text.secondary">
                Surplus (shop these)
              </Typography>
              {surplus.length > 0 ? (
                <Stack spacing={0.5}>
                  {surplus.map((v) => (
                    <PlayerChipRow key={v.playerId} v={v} />
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  None — every keeper-level player fits in your slots.
                </Typography>
              )}
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Typography variant="body2" color="text.secondary">
        Teams ranked by open keeper slots — the more they have, the more a
        keeper-level player is worth to them, and the better your leverage.
      </Typography>

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, 1fr)",
            lg: "repeat(3, 1fr)",
          },
        }}
      >
        {others.map(({ team, keepers, openSlots, assets }) => (
          <Card key={team.rosterId} variant="outlined">
            <CardContent sx={{ p: 1.75, "&:last-child": { pb: 1.75 } }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <Avatar
                  src={sleeperAvatarUrl(team.avatar)}
                  sx={{ width: 28, height: 28 }}
                >
                  {teamLabel(team).slice(0, 1)}
                </Avatar>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontWeight: 600 }}>
                    {teamLabel(team)}
                  </Typography>
                </Box>
                <Tooltip
                  title={`${keepers.length} keeper-level players; ${openSlots} keeper slots they can't fill with keeper-level talent`}
                >
                  <Chip
                    size="small"
                    label={
                      openSlots > 0 ? `${openSlots} open slots` : "slots full"
                    }
                    color={openSlots > 0 ? "success" : "default"}
                    variant={openSlots > 0 ? "filled" : "outlined"}
                  />
                </Tooltip>
              </Stack>
              <Typography variant="overline" color="text.secondary">
                Their best assets
              </Typography>
              <Stack spacing={0.5}>
                {assets.map((v: PlayerValue) => (
                  <PlayerChipRow key={v.playerId} v={v} />
                ))}
                {assets.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No projected players.
                  </Typography>
                ) : null}
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Box>
    </Stack>
  );
}

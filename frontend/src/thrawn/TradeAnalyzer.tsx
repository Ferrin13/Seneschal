import {
  Alert,
  Box,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import { useMemo, useState } from "react";
import type { LeagueValues, PlayerValue, ThrawnTeam } from "./types";
import { fmtPar, positionColor, rosterValues, teamLabel } from "./format";

function PlayerPickRow({
  v,
  checked,
  onToggle,
}: {
  v: PlayerValue;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <Stack
      direction="row"
      spacing={0.75}
      alignItems="center"
      onClick={onToggle}
      sx={{
        cursor: "pointer",
        px: 0.5,
        borderRadius: 1,
        bgcolor: checked ? "rgba(102, 80, 164, 0.1)" : undefined,
        "&:hover": { bgcolor: "rgba(0,0,0,0.04)" },
      }}
    >
      <Checkbox size="small" checked={checked} sx={{ p: 0.5 }} />
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
      <Typography
        variant="body2"
        sx={{
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
          color: v.parStarter > 0 ? "success.main" : "text.disabled",
        }}
      >
        {fmtPar(v.parStarter)}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          fontVariantNumeric: "tabular-nums",
          width: 40,
          textAlign: "right",
          color: v.par > 0 ? "success.main" : "text.disabled",
        }}
      >
        {fmtPar(v.par)}
      </Typography>
    </Stack>
  );
}

function keeperTrio(values: PlayerValue[], maxKeepers: number): PlayerValue[] {
  return [...values]
    .sort((a, b) => b.parStarter - a.parStarter)
    .slice(0, maxKeepers);
}

function TrioSummary({
  title,
  before,
  after,
}: {
  title: string;
  before: PlayerValue[];
  after: PlayerValue[];
}) {
  const beforePas = before.reduce((s, v) => s + v.parStarter, 0);
  const afterPas = after.reduce((s, v) => s + v.parStarter, 0);
  const delta = afterPas - beforePas;
  return (
    <Box sx={{ flex: 1 }}>
      <Typography variant="overline" color="text.secondary">
        {title}
      </Typography>
      <Stack spacing={0.25}>
        {after.map((v) => (
          <Stack key={v.playerId} direction="row" spacing={1} alignItems="center">
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
            <Typography
              variant="body2"
              sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}
            >
              {fmtPar(v.parStarter)}
            </Typography>
          </Stack>
        ))}
      </Stack>
      <Typography variant="body2" sx={{ mt: 1 }}>
        Keeper PAS/G: {fmtPar(afterPas)}{" "}
        <Typography
          component="span"
          variant="body2"
          sx={{
            fontWeight: 700,
            color:
              delta > 0.05
                ? "success.main"
                : delta < -0.05
                ? "error.main"
                : "text.secondary",
          }}
        >
          ({delta >= 0 ? "+" : ""}
          {delta.toFixed(1)} vs. now)
        </Typography>
      </Typography>
    </Box>
  );
}

/**
 * Sandbox a trade: pick a partner, check players moving each way, and see
 * both the raw PAS/PAR exchanged and what each side's keeper lineup looks like
 * after the deal.
 */
export function TradeAnalyzer({
  teams,
  valuation,
  league,
}: Pick<LeagueValues, "teams" | "valuation" | "league">) {
  const [partnerId, setPartnerId] = useState<number | "">("");
  const [sending, setSending] = useState<Set<string>>(new Set());
  const [receiving, setReceiving] = useState<Set<string>>(new Set());

  const myRosterId = league.myRosterId;
  const partner: ThrawnTeam | undefined = teams.find(
    (t) => t.rosterId === partnerId
  );

  const myValues = useMemo(
    () => (myRosterId != null ? rosterValues(valuation.values, myRosterId) : []),
    [valuation.values, myRosterId]
  );
  const partnerValues = useMemo(
    () =>
      partnerId !== "" ? rosterValues(valuation.values, partnerId) : [],
    [valuation.values, partnerId]
  );

  if (myRosterId == null) {
    return (
      <Alert severity="info">
        Pick your team in the "My team" selector above to analyze trades.
      </Alert>
    );
  }

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const sendingValues = myValues.filter((v) => sending.has(v.playerId));
  const receivingValues = partnerValues.filter((v) => receiving.has(v.playerId));
  const sendPas = sendingValues.reduce((s, v) => s + v.parStarter, 0);
  const recvPas = receivingValues.reduce((s, v) => s + v.parStarter, 0);
  const sendPar = sendingValues.reduce((s, v) => s + v.par, 0);
  const recvPar = receivingValues.reduce((s, v) => s + v.par, 0);

  const myAfter = [
    ...myValues.filter((v) => !sending.has(v.playerId)),
    ...receivingValues,
  ];
  const partnerAfter = [
    ...partnerValues.filter((v) => !receiving.has(v.playerId)),
    ...sendingValues,
  ];
  const { maxKeepers } = league.settings;

  return (
    <Stack spacing={2.5}>
      <FormControl size="small" sx={{ maxWidth: 320 }}>
        <InputLabel id="partner-label">Trade partner</InputLabel>
        <Select
          labelId="partner-label"
          label="Trade partner"
          value={partnerId}
          onChange={(e) => {
            setPartnerId(e.target.value === "" ? "" : Number(e.target.value));
            setReceiving(new Set());
          }}
        >
          {teams
            .filter((t) => t.rosterId !== myRosterId)
            .map((t) => (
              <MenuItem key={t.rosterId} value={t.rosterId}>
                {teamLabel(t)}
              </MenuItem>
            ))}
        </Select>
      </FormControl>

      {partner ? (
        <>
          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <Card variant="outlined" sx={{ flex: 1 }}>
              <CardContent sx={{ p: 1.75, "&:last-child": { pb: 1.75 } }}>
                <Typography sx={{ fontWeight: 600, mb: 1 }}>
                  You send
                </Typography>
                <Stack spacing={0.25}>
                  {myValues.map((v) => (
                    <PlayerPickRow
                      key={v.playerId}
                      v={v}
                      checked={sending.has(v.playerId)}
                      onToggle={() => toggle(sending, setSending, v.playerId)}
                    />
                  ))}
                </Stack>
              </CardContent>
            </Card>
            <Card variant="outlined" sx={{ flex: 1 }}>
              <CardContent sx={{ p: 1.75, "&:last-child": { pb: 1.75 } }}>
                <Typography sx={{ fontWeight: 600, mb: 1 }}>
                  You receive from {teamLabel(partner)}
                </Typography>
                <Stack spacing={0.25}>
                  {partnerValues.map((v) => (
                    <PlayerPickRow
                      key={v.playerId}
                      v={v}
                      checked={receiving.has(v.playerId)}
                      onToggle={() => toggle(receiving, setReceiving, v.playerId)}
                    />
                  ))}
                </Stack>
              </CardContent>
            </Card>
          </Stack>

          <Card variant="outlined" sx={{ borderColor: "secondary.main" }}>
            <CardContent>
              <Stack
                direction="row"
                spacing={1.5}
                alignItems="center"
                sx={{ mb: 1.5 }}
              >
                <SwapHorizIcon color="secondary" />
                <Typography sx={{ fontWeight: 600 }}>
                  Trade summary
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  You send {fmtPar(sendPas)} PAS/G · receive {fmtPar(recvPas)}{" "}
                  PAS/G ·{" "}
                  <Typography
                    component="span"
                    variant="body2"
                    sx={{
                      fontWeight: 700,
                      color:
                        recvPas - sendPas > 0.05
                          ? "success.main"
                          : recvPas - sendPas < -0.05
                          ? "error.main"
                          : "text.secondary",
                    }}
                  >
                    net {fmtPar(recvPas - sendPas)}
                  </Typography>{" "}
                  (PAR/G: {fmtPar(sendPar)} out, {fmtPar(recvPar)} in, net{" "}
                  {fmtPar(recvPar - sendPar)})
                </Typography>
              </Stack>
              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={3}
                divider={<Divider orientation="vertical" flexItem />}
              >
                <TrioSummary
                  title={`Your keepers after (top ${maxKeepers})`}
                  before={keeperTrio(myValues, maxKeepers)}
                  after={keeperTrio(myAfter, maxKeepers)}
                />
                <TrioSummary
                  title={`${teamLabel(partner)} keepers after`}
                  before={keeperTrio(partnerValues, maxKeepers)}
                  after={keeperTrio(partnerAfter, maxKeepers)}
                />
              </Stack>
            </CardContent>
          </Card>
        </>
      ) : (
        <Typography color="text.secondary">
          Choose a partner to start building a trade.
        </Typography>
      )}
    </Stack>
  );
}

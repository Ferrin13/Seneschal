import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { formatDuration, PHASE_LABELS } from "./format";
import { FactionIcon } from "./FactionIcon";
import { StrategyCardFace, StrategyCardThumb } from "./StrategyCardArt";
import type { Faction, GameSnapshot, LazaxPlayer, StrategyCard } from "./types";
import { useLazaxGame } from "./useLazaxGame";

type ConfirmKind = "finish-game" | "finish-round" | "advance-phase" | null;

const NEXT_PHASE_LABEL: Record<string, string> = {
  strategy: "Action",
  action: "Status",
  status: "Agenda",
};

const panelSx = {
  p: { xs: 2, md: 2.5 },
  borderRadius: 2.5,
  border: "1px solid",
  borderColor: "divider",
  bgcolor: "background.paper",
} as const;

function orderPlayers(
  game: GameSnapshot["game"],
  players: LazaxPlayer[],
  factions: Record<string, Faction>
): LazaxPlayer[] {
  const initiativeOf = (p: LazaxPlayer) => {
    const override = factions[p.factionId]?.initiativeOverride;
    if (override != null) return override;
    if (p.strategyCard == null) return Number.POSITIVE_INFINITY;
    return p.strategyCard;
  };

  if (game.phase === "action") {
    return [...players].sort((a, b) => {
      const ia = initiativeOf(a);
      const ib = initiativeOf(b);
      if (ia !== ib) return ia - ib;
      return a.seatIndex - b.seatIndex;
    });
  }
  if (game.phase === "agenda" && game.speakerPlayerId) {
    const sorted = [...players].sort((a, b) => a.seatIndex - b.seatIndex);
    const speakerIdx = sorted.findIndex((p) => p.id === game.speakerPlayerId);
    if (speakerIdx < 0) return sorted;
    const fromSpeaker = [
      ...sorted.slice(speakerIdx),
      ...sorted.slice(0, speakerIdx),
    ];
    return fromSpeaker.length <= 1
      ? fromSpeaker
      : [...fromSpeaker.slice(1), fromSpeaker[0]!];
  }
  return [...players].sort((a, b) => a.seatIndex - b.seatIndex);
}

function PlayerRow({
  player,
  faction,
  isActive,
  isSpeaker,
  totalMs,
  roundMs,
  selectable,
  onSelect,
  onClearStrategyCard,
  phase,
}: {
  player: LazaxPlayer;
  faction?: Faction;
  isActive: boolean;
  isSpeaker: boolean;
  totalMs: number;
  roundMs: number;
  selectable: boolean;
  onSelect?: () => void;
  /** Strategy phase: tap card art to clear the player's pick. */
  onClearStrategyCard?: () => void;
  phase: string;
}) {
  const passed = player.actionState === "passed";
  const canClearCard =
    !!onClearStrategyCard && player.strategyCard != null;

  return (
    <Box
      onClick={selectable ? onSelect : undefined}
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "1fr auto",
          // Wide enough for square exhausted backs at front height (~75px).
          sm: "76px 1fr auto auto",
        },
        gap: { xs: 1.25, sm: 2 },
        alignItems: "center",
        px: 1.75,
        py: 1.5,
        borderRadius: 2,
        border: "1px solid",
        borderColor: isActive
          ? faction?.color ?? "secondary.main"
          : "divider",
        bgcolor: isActive ? "action.hover" : "transparent",
        boxShadow: isActive
          ? `inset 3px 0 0 ${faction?.color ?? "#6650A4"}`
          : "none",
        cursor: selectable ? "pointer" : "default",
        opacity: passed ? 0.45 : 1,
        filter: passed ? "grayscale(1)" : "none",
        transition:
          "background 120ms ease, border-color 120ms ease, opacity 120ms ease, filter 120ms ease",
        "&:hover": selectable ? { bgcolor: "action.hover" } : undefined,
      }}
    >
      <Box
        onClick={
          canClearCard
            ? (e) => {
                e.stopPropagation();
                onClearStrategyCard();
              }
            : undefined
        }
        title={canClearCard ? "Clear strategy card" : undefined}
        sx={{
          display: { xs: "none", sm: "grid" },
          width: 76,
          flexShrink: 0,
          placeItems: "center",
          cursor: canClearCard ? "pointer" : "default",
          borderRadius: 1,
          "&:hover": canClearCard
            ? { outline: "2px solid", outlineColor: "warning.main" }
            : undefined,
        }}
      >
        {player.strategyCard != null ? (
          <StrategyCardThumb
            initiative={player.strategyCard}
            width={60}
            exhausted={player.actionState === "exhausted"}
          />
        ) : (
          <Box
            sx={{
              width: 60,
              height: Math.round(60 / (400 / 499)),
              borderRadius: 1,
              border: "1px dashed",
              borderColor: "divider",
            }}
          />
        )}
      </Box>

      <Stack spacing={0.25} minWidth={0}>
        <Stack direction="row" spacing={1} alignItems="center">
          <FactionIcon
            factionId={player.factionId}
            color={faction?.color}
            size={26}
          />
          <Typography fontWeight={600} noWrap>
            {player.displayName}
          </Typography>
          {isSpeaker ? (
            <Chip
              size="small"
              label="Speaker"
              sx={{ height: 20, fontSize: 11 }}
            />
          ) : null}
          {isActive ? (
            <Chip
              size="small"
              label="Active"
              color="secondary"
              sx={{ height: 20, fontSize: 11 }}
            />
          ) : null}
        </Stack>
        <Typography variant="body2" color="text.secondary" noWrap>
          {faction?.name ?? player.factionId}
          {phase === "action" ? ` · ${player.actionState}` : ""}
        </Typography>
      </Stack>

      <Stack
        alignItems="flex-end"
        sx={{ display: { xs: "none", sm: "flex" }, minWidth: 72 }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ letterSpacing: 0.6, textTransform: "uppercase" }}
        >
          Total
        </Typography>
        <Typography
          sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}
        >
          {formatDuration(totalMs)}
        </Typography>
      </Stack>

      <Stack alignItems="flex-end" minWidth={72}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ letterSpacing: 0.6, textTransform: "uppercase" }}
        >
          Round
        </Typography>
        <Typography
          sx={{
            fontVariantNumeric: "tabular-nums",
            fontWeight: 700,
          }}
        >
          {formatDuration(roundMs)}
        </Typography>
      </Stack>
    </Box>
  );
}

export function GameBoard({ gameId }: { gameId: string }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { snapshot, loading, error, openElapsedMs, mutate } =
    useLazaxGame(gameId);
  const [factions, setFactions] = useState<Record<string, Faction>>({});
  const [strategyCards, setStrategyCards] = useState<StrategyCard[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmKind>(null);

  useEffect(() => {
    void api.lazaxFactions().then((r) => {
      setFactions(Object.fromEntries(r.factions.map((f) => [f.id, f])));
      setStrategyCards(r.strategyCards);
    });
    void api
      .me()
      .then((m) => setMeId(m.id))
      .catch(() => undefined);
  }, []);

  const isAdmin =
    !!snapshot && !!meId && snapshot.game.ownerUserId === meId;

  const takenCards = useMemo(() => {
    if (!snapshot) return new Set<number>();
    return new Set(
      snapshot.players
        .map((p) => p.strategyCard)
        .filter((c): c is number => c != null)
    );
  }, [snapshot]);

  const run = async (action: string, body?: unknown) => {
    setActionError(null);
    setBusy(true);
    try {
      await mutate(action, body);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !snapshot) {
    return <Typography color="text.secondary">Loading game…</Typography>;
  }
  if (error && !snapshot) {
    return <Alert severity="error">{error}</Alert>;
  }
  if (!snapshot) return null;

  const { game, players, totals } = snapshot;
  const active = players.find((p) => p.id === game.activePlayerId);
  const activeFaction = active ? factions[active.factionId] : null;
  const orderedPlayers = orderPlayers(game, players, factions);

  const playerTotal = (playerId: string) => {
    let ms = totals?.byPlayer?.[playerId] ?? 0;
    if (
      snapshot.openSegment?.kind === "player" &&
      snapshot.openSegment.playerId === playerId
    ) {
      ms += openElapsedMs;
    }
    return ms;
  };

  const playerRound = (playerId: string) => {
    let ms = totals?.byPlayerRound?.[playerId]?.[game.roundNumber] ?? 0;
    if (
      snapshot.openSegment?.kind === "player" &&
      snapshot.openSegment.playerId === playerId &&
      snapshot.openSegment.roundNumber === game.roundNumber
    ) {
      ms += openElapsedMs;
    }
    return ms;
  };

  const roundEntries = Object.keys(totals?.byRound ?? {})
    .map(Number)
    .sort((a, b) => a - b)
    .map((round) => {
      let ms = totals.byRound[round] ?? 0;
      if (
        snapshot.openSegment &&
        snapshot.openSegment.roundNumber === round
      ) {
        ms += openElapsedMs;
      }
      return { round, ms };
    });

  let liveGeneral = totals?.generalMs ?? 0;
  if (snapshot.openSegment?.kind === "general") {
    liveGeneral += openElapsedMs;
  }
  let liveTotal = totals?.totalMs ?? 0;
  if (snapshot.openSegment) {
    liveTotal += openElapsedMs;
  }
  let liveRound = totals?.byRound?.[game.roundNumber] ?? 0;
  if (
    snapshot.openSegment &&
    snapshot.openSegment.roundNumber === game.roundNumber
  ) {
    liveRound += openElapsedMs;
  }
  // Big clock only tracks an active player turn; general/paused stays frozen.
  const mainClockMs =
    snapshot.openSegment?.kind === "player" ? openElapsedMs : 0;

  return (
    <Box sx={{ minHeight: "70vh" }}>
      <Stack spacing={3}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          justifyContent="space-between"
          alignItems={{ md: "flex-start" }}
          spacing={2}
        >
          <Box>
            <Typography
              variant="overline"
              sx={{ letterSpacing: 4, color: "secondary.main" }}
            >
              Lazax
            </Typography>
            <Typography
              variant="h3"
              sx={{
                fontWeight: 500,
                letterSpacing: -0.5,
                fontSize: { xs: "1.85rem", md: "2.4rem" },
              }}
            >
              {game.name}
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              sx={{ mt: 1.5 }}
              flexWrap="wrap"
              useFlexGap
            >
              <Chip label={`Round ${game.roundNumber}`} variant="outlined" />
              <Chip
                label={PHASE_LABELS[game.phase] ?? game.phase}
                color="primary"
              />
              <Chip
                label={game.clockState === "running" ? "Running" : "Paused"}
                color={game.clockState === "running" ? "success" : "warning"}
                variant="outlined"
              />
            </Stack>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              onClick={() => navigate(`/lazax/${gameId}/stats`)}
            >
              Full stats
            </Button>
            <Button onClick={() => navigate("/lazax")}>All games</Button>
          </Stack>
        </Stack>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", lg: "1.4fr 0.9fr" },
            gap: 2.5,
            alignItems: "start",
          }}
        >
          <Stack spacing={2.5}>
            <Box
              sx={{
                ...panelSx,
                py: { xs: 4, md: 5 },
                textAlign: "center",
                bgcolor: "background.paper",
              }}
            >
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{ letterSpacing: 2 }}
              >
                {game.clockState === "paused"
                  ? "General / paused"
                  : active
                    ? `${active.displayName}'s turn`
                    : "General time"}
              </Typography>
              {active ? (
                <Stack alignItems="center" sx={{ mt: 1.5, mb: 0.5 }}>
                  <FactionIcon
                    factionId={active.factionId}
                    color={activeFaction?.color}
                    size={72}
                  />
                </Stack>
              ) : null}
              <Typography
                sx={{
                  fontSize: { xs: "3.75rem", md: "5.25rem" },
                  fontWeight: 200,
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1.05,
                  color: activeFaction?.color ?? "primary.main",
                  mt: 0.5,
                }}
              >
                {formatDuration(mainClockMs)}
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                {activeFaction?.name ??
                  (game.phase === "agenda" && !active
                    ? "Agenda — waiting to open voting"
                    : PHASE_LABELS[game.phase])}
              </Typography>
              <Stack
                direction="row"
                spacing={3}
                justifyContent="center"
                sx={{ mt: 3 }}
              >
                <Stack>
                  <Typography variant="caption" color="text.secondary">
                    GAME TOTAL
                  </Typography>
                  <Typography sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {formatDuration(liveTotal)}
                  </Typography>
                </Stack>
                <Stack>
                  <Typography variant="caption" color="text.secondary">
                    ROUND {game.roundNumber}
                  </Typography>
                  <Typography sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {formatDuration(liveRound)}
                  </Typography>
                </Stack>
                <Stack>
                  <Typography variant="caption" color="text.secondary">
                    GENERAL
                  </Typography>
                  <Typography sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {formatDuration(liveGeneral)}
                  </Typography>
                </Stack>
              </Stack>
            </Box>

            {actionError ? <Alert severity="error">{actionError}</Alert> : null}

            {isAdmin && game.status === "setup" ? (
              <Box sx={panelSx}>
                <Button
                  variant="contained"
                  size="large"
                  fullWidth
                  disabled={busy}
                  onClick={() => void run("start")}
                  sx={{ py: 1.5, fontWeight: 700 }}
                >
                  Start game
                </Button>
              </Box>
            ) : null}

            {isAdmin && game.status === "active" ? (
              <Box sx={panelSx}>
                <Typography
                  variant="overline"
                  color="secondary.main"
                  sx={{ letterSpacing: 2, display: "block", mb: 1.5 }}
                >
                  Controls
                </Typography>
                <Stack spacing={1.25}>
                  {game.phase !== "status" ? (
                    <Button
                      variant="contained"
                      color="primary"
                      size="large"
                      fullWidth
                      disabled={
                        busy ||
                        (!game.activePlayerId && game.phase !== "agenda")
                      }
                      onClick={() => void run("end-turn")}
                      sx={{
                        py: 2,
                        fontSize: "1.15rem",
                        fontWeight: 800,
                        letterSpacing: 0.4,
                      }}
                    >
                      {game.phase === "agenda" && !game.activePlayerId
                        ? "Start voting"
                        : "Next turn"}
                    </Button>
                  ) : null}
                  {game.clockState === "running" ? (
                    <Button
                      variant="outlined"
                      disabled={busy}
                      onClick={() => void run("pause")}
                    >
                      Pause
                    </Button>
                  ) : (
                    <Button
                      variant="contained"
                      color="success"
                      disabled={busy}
                      onClick={() => void run("resume")}
                    >
                      Resume
                    </Button>
                  )}
                  {game.phase === "action" ? (
                    <Stack direction="row" spacing={1}>
                      <Button
                        fullWidth
                        disabled={busy || !game.activePlayerId}
                        onClick={() => void run("pass")}
                      >
                        Pass
                      </Button>
                      <Button
                        fullWidth
                        disabled={busy || !game.activePlayerId}
                        onClick={() => void run("exhaust")}
                      >
                        Exhaust
                      </Button>
                      <Button
                        fullWidth
                        disabled={busy || !game.activePlayerId}
                        onClick={() => void run("ready")}
                      >
                        Ready
                      </Button>
                    </Stack>
                  ) : null}
                  <Divider sx={{ my: 0.5 }} />
                  {game.phase === "agenda" ? (
                    <Button
                      disabled={busy}
                      onClick={() => setConfirm("finish-round")}
                    >
                      Finish round
                    </Button>
                  ) : (
                    <Button
                      disabled={busy}
                      onClick={() => setConfirm("advance-phase")}
                    >
                      Advance phase
                    </Button>
                  )}
                  <Button
                    color="warning"
                    disabled={busy}
                    onClick={() => setConfirm("finish-game")}
                  >
                    Finish game
                  </Button>
                </Stack>
              </Box>
            ) : null}

            {!isAdmin && user ? (
              <Typography variant="body2" color="text.secondary">
                View-only on this account (not the game owner).
              </Typography>
            ) : null}

            {game.phase === "strategy" &&
            game.activePlayerId &&
            isAdmin &&
            game.status === "active" ? (
              <Box sx={panelSx}>
                <Typography
                  variant="overline"
                  color="secondary.main"
                  sx={{ letterSpacing: 2, display: "block" }}
                >
                  Select strategy card
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  For{" "}
                  {players.find((p) => p.id === game.activePlayerId)
                    ?.displayName ?? "active player"}
                </Typography>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(152px, 1fr))",
                    gap: 2.5,
                    justifyItems: "center",
                  }}
                >
                  {strategyCards.map((c) => {
                    const taken = takenCards.has(c.initiative);
                    const ownedByActive = players.some(
                      (p) =>
                        p.id === game.activePlayerId &&
                        p.strategyCard === c.initiative
                    );
                    return (
                      <StrategyCardFace
                        key={c.initiative}
                        initiative={c.initiative}
                        width={148}
                        showName={false}
                        disabled={taken && !ownedByActive}
                        selected={ownedByActive}
                        onClick={() =>
                          void run("strategy-card", {
                            playerId: game.activePlayerId,
                            card: ownedByActive ? null : c.initiative,
                          })
                        }
                      />
                    );
                  })}
                </Box>
              </Box>
            ) : null}
          </Stack>

          <Stack spacing={2.5}>
            <Box sx={panelSx}>
              <Typography
                variant="overline"
                color="secondary.main"
                sx={{ letterSpacing: 2, mb: 1.5, display: "block" }}
              >
                Players
              </Typography>
              <Stack spacing={1}>
                {orderedPlayers.map((p) => (
                  <PlayerRow
                    key={p.id}
                    player={p}
                    faction={factions[p.factionId]}
                    isActive={game.activePlayerId === p.id}
                    isSpeaker={game.speakerPlayerId === p.id}
                    totalMs={playerTotal(p.id)}
                    roundMs={playerRound(p.id)}
                    selectable={
                      isAdmin &&
                      game.clockState === "paused" &&
                      game.status === "active"
                    }
                    onSelect={() =>
                      void run("active-player", { playerId: p.id })
                    }
                    onClearStrategyCard={
                      isAdmin &&
                      game.phase === "strategy" &&
                      game.status === "active" &&
                      p.strategyCard != null
                        ? () =>
                            void run("strategy-card", {
                              playerId: p.id,
                              card: null,
                            })
                        : undefined
                    }
                    phase={game.phase}
                  />
                ))}
              </Stack>
              {isAdmin && game.phase === "strategy" && game.status === "active" ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                  Tap a player&apos;s strategy card to clear their pick.
                </Typography>
              ) : null}
              {game.clockState === "paused" && isAdmin ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                  Paused — tap a player to override who is active, then Resume.
                </Typography>
              ) : null}
            </Box>

            <Box sx={panelSx}>
              <Typography
                variant="overline"
                color="secondary.main"
                sx={{ letterSpacing: 2, display: "block" }}
              >
                Round times
              </Typography>
              {roundEntries.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  No time recorded yet.
                </Typography>
              ) : (
                <Stack spacing={1} sx={{ mt: 1.5 }}>
                  {roundEntries.map(({ round, ms }) => {
                    const isCurrent = round === game.roundNumber;
                    return (
                      <Stack
                        key={round}
                        direction="row"
                        justifyContent="space-between"
                        alignItems="center"
                        sx={{
                          px: 1.5,
                          py: 1,
                          borderRadius: 1.5,
                          bgcolor: isCurrent ? "action.selected" : "action.hover",
                          border: "1px solid",
                          borderColor: isCurrent ? "secondary.light" : "transparent",
                        }}
                      >
                        <Typography fontWeight={isCurrent ? 600 : 400}>
                          Round {round}
                          {isCurrent ? " · current" : ""}
                        </Typography>
                        <Typography
                          sx={{
                            fontVariantNumeric: "tabular-nums",
                            fontWeight: 600,
                          }}
                        >
                          {formatDuration(ms)}
                        </Typography>
                      </Stack>
                    );
                  })}
                </Stack>
              )}
            </Box>
          </Stack>
        </Box>
      </Stack>

      <Dialog
        open={confirm != null}
        onClose={() => (busy ? undefined : setConfirm(null))}
      >
        <DialogTitle>
          {confirm === "finish-game"
            ? "Finish game?"
            : confirm === "finish-round"
              ? "Finish round?"
              : "Advance phase?"}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {confirm === "finish-game"
              ? "This ends the game and stops the clock. You can still view stats afterward."
              : confirm === "finish-round"
                ? `This ends round ${game.roundNumber}, clears strategy cards, and starts the next strategy phase.`
                : `Leave the ${PHASE_LABELS[game.phase] ?? game.phase} phase and move to ${NEXT_PHASE_LABEL[game.phase] ?? "the next phase"}?`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            color={confirm === "finish-game" ? "warning" : "primary"}
            variant="contained"
            disabled={busy}
            onClick={() => {
              const action =
                confirm === "finish-game" ? "finish" : "advance-phase";
              setConfirm(null);
              void run(action);
            }}
          >
            {confirm === "finish-game"
              ? "Finish game"
              : confirm === "finish-round"
                ? "Finish round"
                : "Advance phase"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

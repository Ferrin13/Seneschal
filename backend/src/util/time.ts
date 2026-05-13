/**
 * 15-minute slot helpers. All operations are in UTC; the client is
 * responsible for translating to the user's local wall-clock for display.
 */
export const SLOT_MS = 15 * 60 * 1000;

export function floorToSlot(d: Date): Date {
  const t = d.getTime();
  return new Date(t - (t % SLOT_MS));
}

export function isSlotAligned(d: Date): boolean {
  return d.getTime() % SLOT_MS === 0;
}

/**
 * Returns every 15-minute slot start (inclusive) whose midpoint falls
 * within `[start, end)`. Used by the timer-stop endpoint to decide which
 * slots to fill: edge slots that are <50% covered are skipped, which keeps
 * the "every slot is one activity" invariant feeling natural.
 */
export function slotsCoveredByMidpoint(start: Date, end: Date): Date[] {
  if (end.getTime() <= start.getTime()) return [];
  const result: Date[] = [];
  const firstSlot = floorToSlot(start);
  for (let t = firstSlot.getTime(); t < end.getTime(); t += SLOT_MS) {
    const midpoint = t + SLOT_MS / 2;
    if (midpoint >= start.getTime() && midpoint < end.getTime()) {
      result.push(new Date(t));
    }
  }
  return result;
}

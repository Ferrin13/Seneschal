import { describe, it, expect } from "vitest";
import {
  floorToSlot,
  isSlotAligned,
  slotsCoveredByMidpoint,
  SLOT_MS,
} from "../src/util/time.js";

describe("time slot helpers", () => {
  it("floors to the nearest 15 minutes", () => {
    const d = new Date("2026-05-12T10:23:45.000Z");
    expect(floorToSlot(d).toISOString()).toBe("2026-05-12T10:15:00.000Z");
  });

  it("recognises aligned slots", () => {
    expect(isSlotAligned(new Date("2026-05-12T10:15:00.000Z"))).toBe(true);
    expect(isSlotAligned(new Date("2026-05-12T10:16:00.000Z"))).toBe(false);
  });

  it("covers slots whose midpoint falls in [start,end)", () => {
    const start = new Date("2026-05-12T10:07:00.000Z"); // mid of 10:00 slot is 10:07:30 -> in
    const end = new Date("2026-05-12T10:53:00.000Z"); // mid of 10:45 is 10:52:30 -> in
    const slots = slotsCoveredByMidpoint(start, end).map((d) =>
      d.toISOString()
    );
    expect(slots).toEqual([
      "2026-05-12T10:00:00.000Z",
      "2026-05-12T10:15:00.000Z",
      "2026-05-12T10:30:00.000Z",
      "2026-05-12T10:45:00.000Z",
    ]);
  });

  it("excludes edge slots when <50% covered", () => {
    const start = new Date("2026-05-12T10:08:00.000Z"); // mid 10:07:30 NOT in
    const end = new Date("2026-05-12T10:52:00.000Z"); // mid 10:52:30 NOT in
    const slots = slotsCoveredByMidpoint(start, end).map((d) =>
      d.toISOString()
    );
    expect(slots).toEqual([
      "2026-05-12T10:15:00.000Z",
      "2026-05-12T10:30:00.000Z",
    ]);
  });

  it("returns empty when end <= start", () => {
    const t = new Date();
    expect(slotsCoveredByMidpoint(t, t)).toEqual([]);
    expect(slotsCoveredByMidpoint(t, new Date(t.getTime() - SLOT_MS))).toEqual(
      []
    );
  });
});

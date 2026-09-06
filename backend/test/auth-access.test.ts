import { describe, expect, it } from "vitest";
import {
  canAccessPath,
  FEATURES,
  normalizeFeatures,
  requirementForPath,
  resolveAccess,
  type Access,
} from "../src/auth/access.js";

const BOOTSTRAP = ["Admin@Example.com"];

describe("requirementForPath", () => {
  it("maps each product prefix to its feature", () => {
    expect(requirementForPath("/categories")).toEqual({
      kind: "feature",
      feature: "time_tracking",
    });
    expect(requirementForPath("/timer/start")).toEqual({
      kind: "feature",
      feature: "time_tracking",
    });
    expect(requirementForPath("/voice/command")).toEqual({
      kind: "feature",
      feature: "time_tracking",
    });
    expect(requirementForPath("/expenses")).toEqual({
      kind: "feature",
      feature: "expenses",
    });
    expect(requirementForPath("/uploads/sign?key=x")).toEqual({
      kind: "feature",
      feature: "expenses",
    });
    expect(requirementForPath("/group-members")).toEqual({
      kind: "feature",
      feature: "group_texting",
    });
    expect(requirementForPath("/marketplace/candidates/abc")).toEqual({
      kind: "feature",
      feature: "deal_hunter",
    });
    expect(requirementForPath("/settings/models")).toEqual({
      kind: "feature",
      feature: "deal_hunter",
    });
    expect(requirementForPath("/lazax/ws?token=t&gameId=g")).toEqual({
      kind: "feature",
      feature: "lazax",
    });
    expect(requirementForPath("/thrawn/leagues/1/values")).toEqual({
      kind: "feature",
      feature: "thrawn",
    });
    expect(requirementForPath("/descartes/graph")).toEqual({
      kind: "feature",
      feature: "descartes",
    });
    expect(requirementForPath("/bible/passage?q=John+1")).toEqual({
      kind: "feature",
      feature: "descartes",
    });
    expect(requirementForPath("/moneyball/board")).toEqual({
      kind: "feature",
      feature: "moneyball",
    });
  });

  it("treats /me as open and /admin as admin-only", () => {
    expect(requirementForPath("/me")).toEqual({ kind: "open" });
    expect(requirementForPath("/admin/users")).toEqual({ kind: "admin" });
    expect(requirementForPath("/admin/users/a%40b.com")).toEqual({
      kind: "admin",
    });
    // Roster CRUD is admin-only even though it's Moneyball data.
    expect(requirementForPath("/admin/moneyball/players")).toEqual({ kind: "admin" });
  });

  it("matches on segment boundaries only", () => {
    expect(requirementForPath("/lazaxfoo")).toEqual({ kind: "unknown" });
    expect(requirementForPath("/meat")).toEqual({ kind: "unknown" });
    expect(requirementForPath("/")).toEqual({ kind: "unknown" });
  });
});

describe("resolveAccess", () => {
  it("returns null when there is no row and the email is not bootstrap", () => {
    expect(resolveAccess("someone@example.com", null, BOOTSTRAP)).toBeNull();
  });

  it("uses the stored row for ordinary accounts", () => {
    const access = resolveAccess(
      "someone@example.com",
      { isAdmin: false, features: ["lazax", "bogus", "lazax", "thrawn"] },
      BOOTSTRAP
    );
    expect(access).toEqual({
      isAdmin: false,
      features: ["lazax", "thrawn"],
      bootstrap: false,
    });
  });

  it("gives bootstrap admins everything when no row exists", () => {
    const access = resolveAccess("admin@example.com", null, BOOTSTRAP);
    expect(access).toEqual({
      isAdmin: true,
      features: [...FEATURES],
      bootstrap: true,
    });
  });

  it("forces isAdmin for bootstrap admins but honors their feature list", () => {
    const access = resolveAccess(
      "ADMIN@example.com",
      { isAdmin: false, features: ["descartes"] },
      BOOTSTRAP
    );
    expect(access).toEqual({
      isAdmin: true,
      features: ["descartes"],
      bootstrap: true,
    });
  });
});

describe("canAccessPath", () => {
  const viewer: Access = {
    isAdmin: false,
    features: ["lazax"],
    bootstrap: false,
  };
  const admin: Access = { isAdmin: true, features: [], bootstrap: false };

  it("allows open paths to anyone signed in", () => {
    expect(canAccessPath(viewer, "/me")).toBe(true);
  });

  it("gates features", () => {
    expect(canAccessPath(viewer, "/lazax/games")).toBe(true);
    expect(canAccessPath(viewer, "/thrawn/leagues")).toBe(false);
  });

  it("gates admin paths on the admin flag, not on features", () => {
    expect(canAccessPath(viewer, "/admin/users")).toBe(false);
    expect(canAccessPath(admin, "/admin/users")).toBe(true);
    // Admin is not a superset of features.
    expect(canAccessPath(admin, "/lazax/games")).toBe(false);
  });

  it("fails closed for unmapped paths", () => {
    expect(canAccessPath(admin, "/something-new")).toBe(false);
  });
});

describe("normalizeFeatures", () => {
  it("returns canonical order without duplicates or unknowns", () => {
    expect(normalizeFeatures(["thrawn", 3, "time_tracking", "thrawn"])).toEqual([
      "time_tracking",
      "thrawn",
    ]);
  });
});

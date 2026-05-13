import { auth } from "./firebase";

const API_BASE_URL: string = (
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080"
).replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function authedFetch(path: string, init: RequestInit = {}) {
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, "not signed in");
  const token = await user.getIdToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    throw new ApiError(res.status, body || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

export type Me = {
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
};

export type Category = {
  id: string;
  name: string;
  kind: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  clientUpdatedAt: string;
  deletedAt: string | null;
};

export type Activity = {
  id: string;
  categoryId: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  clientUpdatedAt: string;
  deletedAt: string | null;
};

export type Slot = {
  slotStartUtc: string;
  primaryActivityId: string | null;
  secondaryActivityId: string | null;
  notes: string | null;
  updatedAt: string;
  clientUpdatedAt: string;
  deletedAt: string | null;
};

export const api = {
  me: () => authedFetch("/me") as Promise<Me>,
  categories: () => authedFetch("/categories") as Promise<Category[]>,
  activities: () => authedFetch("/activities") as Promise<Activity[]>,
  slots: (fromIso: string, toIso: string) =>
    authedFetch(
      `/slots?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`
    ) as Promise<Slot[]>,
};

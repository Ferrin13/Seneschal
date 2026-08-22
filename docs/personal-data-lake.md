# Personal Data Lake — Design Doc

A single-node index of my own data (Docs, Sheets, Gmail, SMS, Signal, financial transactions), built as a **seneschal subsystem**: stored in the existing Postgres, synced by Temporal, blobs in the existing S3 path, and queried through the server tool registry.

---

## 1. Goals

- **One place.** All personal data in a single store with a consistent shape, rather than an LLM fanning out to a half-dozen cloud connectors.
- **Self-controlled store.** No third party holds the *aggregate at rest*. Query results transit the LLM provider like any other seneschal traffic — that's an accepted trade-off; the goal is about storage, not query-time transit.
- **Full history, kept forever.** Everything I've ever written, with original timestamps preserved. The archive outlives the sources: deletions upstream do **not** propagate here (see §4.4).
- **Fresh enough.** Not real time. Within ~15–30 minutes for most sources; within ~1 hour for SMS so "what did I get texted today" works.
- **Shaped for an LLM.** Normalized records the model can filter and search predictably.

## 2. Non-goals

- Replacing the source systems. Google Docs stays the editing surface; this is a read-only mirror.
- Per-document version history. **Decided: latest-only.** The `documents` row always holds current content; the raw API payload from each sync lands in the append-only blob store anyway, so point-in-time content is recoverable later if this ever matters. No versions table.
- Mirroring deletions. A Drive removal or Gmail delete is ignored (optionally noted in `metadata` for provenance); the record stays.
- Vector search, at least for v1. At personal scale the real queries are date ranges plus keyword/phrase matching, and Postgres does both well. Revisit if full-text recall proves inadequate.
- Multi-user, HA, or horizontal scale. Schema carries `user_id` for consistency with the rest of seneschal, but operationally this is one user.

---

## 3. Architecture

This reuses seneschal's existing spine rather than standing up parallel infrastructure:

```
  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
  │  Drive API  │   │ Gmail API   │   │  Phone      │   │  Finances   │
  │ (Docs/Sheets)│  │             │   │ (SMS push + │   │             │
  └──────┬──────┘   └──────┬──────┘   │  XML dump)  │   └──────┬──────┘
         │                 │          └──────┬──────┘          │
    ┌────┴─────────────────┴─────────────────┴─────────────────┴────┐
    │              Connectors (Temporal workflows/activities)       │
    │  per-source: auth, incremental cursor, raw payload capture    │
    └────────────────────────────┬──────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │      Normalizer         │
                    │  → common record shape  │
                    └────────────┬────────────┘
                                 │
              ┌──────────────────┴──────────────────┐
              │                                     │
       ┌──────┴───────┐                    ┌────────┴────────┐
       │   Postgres   │                    │ MinIO, self-    │
       │ (seneschal DB│◄── hash pointer ───│ hosted (via     │
       │  via drizzle)│                    │ s3.ts, CAS keys)│
       └──────┬───────┘                    └─────────────────┘
              │
       ┌──────┴───────┐
       │  Tool pack   │  (server tools in tools/registry.ts,
       └──────────────┘   executed in the existing LLM loop)
```

Concretely:

- **Connectors** are Temporal schedules driving workflows on the existing worker (`temporal/`), one schedule per source. Temporal provides the retry, overlap-skip, and run-history story that a systemd/cron design would have to hand-roll. A connector failing never blocks the others.
- **Schema** lands in `db/schema.ts` via drizzle migrations, alongside the existing tables.
- **Blobs** go through the existing `s3.ts` client with a content-addressed key layout, backed by self-hosted MinIO (§5) — the client already supports it through `S3_ENDPOINT`.
- **Query layer** is a new tool pack registered in `tools/registry.ts` (the pattern `marketplacePack` already establishes), so the voice/LLM loop picks it up with no new plumbing.
- The SMS push path is a new authenticated route in `routes/`, like every other endpoint.

---

## 4. Data model

Illustrative SQL below; the real definitions live in `db/schema.ts` with a hand-written migration for the pieces drizzle doesn't express natively (tsvector generated column, GIN/trigram indexes, extensions).

### 4.1 Core table

One `documents` table is the spine. Everything textual lands here so a single query can search across sources.

```sql
CREATE TABLE documents (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id),
  source        text NOT NULL,           -- 'gdocs' | 'gsheets' | 'gmail' | 'sms' | 'signal' | ...
  external_id   text NOT NULL,           -- source-native ID
  title         text,
  body          text,                    -- extracted plain text (canonical copy)
  occurred_at   timestamptz NOT NULL,    -- when the thing happened (sent/created)
  modified_at   timestamptz,             -- source's last-modified
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  content_hash  text NOT NULL,           -- detect real changes vs. no-op touches
  metadata      jsonb NOT NULL DEFAULT '{}',
  raw_blob      text,                    -- CAS hash of the original payload
  tsv           tsvector GENERATED ALWAYS AS (
                  to_tsvector('english',
                    left(coalesce(title,'') || ' ' || coalesce(body,''), 700000))
                ) STORED,
  UNIQUE (user_id, source, external_id)
);

CREATE INDEX ON documents USING GIN (tsv);
CREATE INDEX ON documents USING GIN (metadata jsonb_path_ops);
CREATE INDEX ON documents (user_id, source, occurred_at DESC);
CREATE INDEX ON documents USING GIN (title gin_trgm_ops);  -- fuzzy title match
```

Notes:
- `occurred_at` vs `modified_at` matters. A doc written in 2019 and touched last week should still sort as a 2019 document for "what was I working on then" queries.
- `UNIQUE (user_id, source, external_id)` makes ingestion an idempotent upsert. Re-running a connector is always safe. Since versions are latest-only (§2), the upsert simply overwrites `body` when `content_hash` differs.
- **tsvector size guard:** Postgres tsvectors cap out around 1MB, and an oversized value fails the *insert*, not the query. The `left(..., 700000)` truncation keeps pathological docs (huge exports, giant threads) from breaking ingestion; `body` itself stays complete for `get_document` and `ts_headline`. If truncation ever costs recall on real queries, that's the trigger to add chunking — which is also the prerequisite for vector search later.
- `content_hash` lets us skip rewriting and re-indexing when Drive reports a change that didn't alter content.
- `pg_trgm` extension for fuzzy matching; `unaccent` is worth enabling too.

### 4.2 Source-specific tables

Anything with real structure gets its own typed table, joined back via `document_id` where a text representation also makes sense. `documents.body` is the canonical text; typed tables carry structure, not duplicate prose.

```sql
CREATE TABLE transactions (
  id           bigserial PRIMARY KEY,
  document_id  bigint REFERENCES documents(id),
  account      text NOT NULL,
  posted_at    date NOT NULL,
  amount       numeric(14,2) NOT NULL,   -- never float
  currency     text NOT NULL DEFAULT 'USD',
  merchant     text,
  category     text,
  external_id  text,
  metadata     jsonb NOT NULL DEFAULT '{}',
  UNIQUE (account, external_id)
);

CREATE TABLE messages (
  id            bigserial PRIMARY KEY,
  document_id   bigint NOT NULL REFERENCES documents(id),
  channel       text NOT NULL,           -- 'sms' | 'signal' | 'gmail'
  thread_id     text,
  direction     text NOT NULL,           -- 'in' | 'out'
  counterparty  text,                    -- normalized: E.164 phone / lowercased email / contact key
  sent_at       timestamptz NOT NULL,
  external_id   text NOT NULL,           -- native ID, or synthetic for SMS (see §6.3)
  UNIQUE (channel, external_id)
);
```

The `UNIQUE (channel, external_id)` constraint is what makes the SMS dual-path (§6.3) actually idempotent — without it, the push webhook and the nightly reconciliation would happily duplicate each other. For sources with native IDs (Gmail, Signal) `external_id` is that ID; for SMS it's a synthetic hash. Message text lives once, in the linked `documents` row.

The point of the split: "sum my grocery spending in Q2" is a SQL aggregate over `transactions`, not a text search. "Find the email where I agreed to that price" is full-text over `documents`. Both should be easy.

### 4.3 Contact identity

Worth solving early: the same person is a phone number in SMS, a UUID in Signal, and an email in Gmail. A `contacts` + `contact_identities` pair maps them:

```sql
CREATE TABLE contacts (
  id            bigserial PRIMARY KEY,
  display_name  text NOT NULL,
  notes         text
);

CREATE TABLE contact_identities (
  contact_id  bigint NOT NULL REFERENCES contacts(id),
  kind        text NOT NULL,   -- 'email' | 'phone' | 'signal'
  value       text NOT NULL,   -- normalized: E.164 phones, lowercased emails
  UNIQUE (kind, value)
);
```

Decisions:

- **Resolution happens at query time, not ingest time.** `messages.counterparty` stores the normalized raw identity; tools join through `contact_identities` when a query names a person. A mapping added tomorrow retroactively covers every historical message with no backfill, and a wrong mapping is a row delete, not a data repair.
- **Seed automatically, confirm manually.** Google Contacts (People API, one extra read-only scope on the existing OAuth grant) provides the email↔phone bridge for most known people; Signal Desktop's own contact table (extracted by that connector anyway) provides the Signal↔phone bridge. Hand-curation is only for the leftovers.
- **Fuzzy matching produces suggestions, never merges.** A small job proposes links (same display name across sources, phone found in an email signature) into a suggestions queue for manual confirmation. False merges are worse than misses — "everything from Dana" silently including someone else poisons answers — so nothing joins a contact without a human yes.
- A "top unresolved counterparties by message count" query surfaces which identities are worth mapping; the long tail of one-off senders stays unmapped by design.

### 4.4 Deletions

**Decided: keep forever.** The archive's whole point is outliving the sources. Connectors will still *receive* removal events (Drive `changes.list` reports removals; Gmail history includes deletes; the SMS XML dump shrinks when messages are deleted on-phone) — the explicit policy is to ignore them, optionally stamping `metadata.deleted_at_source` for provenance. Nothing is ever excluded from search on that basis.

---

## 5. Blob storage

**Decision: blobs in S3 via the existing `s3.ts` client, not in Postgres.** Large binaries in the database bloat backups and pollute the working set, and we never query the bytes. The existing client already handles both real S3 and self-hosted MinIO (`S3_ENDPOINT` + path-style).

Content-addressed keys:

```
blobs/ab/cd/abcdef0123...      # sha256, first 4 hex chars as fan-out prefix
```

Postgres holds `content_hash`, `mime_type`, `size_bytes`, `original_filename`, plus any extracted text. Dedup is free.

Also store the **raw API payload** for every ingested record. Reprocessing without re-fetching is worth the storage — and since the store is append-only and keyed by hash, it doubles as an incidental history of past document states even under the latest-only policy.

For photos (a possible later source): the indexable content is EXIF plus a caption from a vision model. Both are text, both go in Postgres; the JPEG stays in the CAS.

**Decided: the bucket is self-hosted MinIO**, pointed at via `S3_ENDPOINT`. Raw email/SMS/Signal payloads in a third-party bucket would cut against the "no third party holds the aggregate at rest" goal in a way the query-time LLM trade-off doesn't. This keeps the whole aggregate — Postgres and CAS — on hardware I control, and it's a config value, not a code change, if that ever needs revisiting.

---

## 6. Connectors

Each connector is a Temporal workflow on the existing worker, triggered by a per-source schedule with `ScheduleOverlapPolicy.SKIP` (a slow run never overlaps itself — same pattern as the hunt schedules).

### 6.1 Google Docs & Sheets — *easy*

- **Discovery/incremental:** Drive API `changes.list` with a stored `startPageToken`. Returns only what changed since the last poll. Far better than re-listing the whole drive. Removal entries in the feed are ignored per §4.4.
- **Content:** `files.export` for native types.
  - Docs → `text/plain` or `text/markdown`.
  - Sheets → **gotcha:** `text/csv` exports only the first sheet. For multi-tab workbooks export `.xlsx` and parse tabs locally, or hit the Sheets API per-tab.
- **Backfill:** one-time full `files.list` walk before switching to the changes feed.
- **History caveat:** Drive keeps *named/pinned* revisions of native files indefinitely, but prunes unnamed ones. Past versions cannot be fully backfilled — consistent with the latest-only decision, we don't try.
- **Auth:** OAuth desktop flow once, then a stored refresh token. Read-only scopes.

### 6.2 Gmail — *easy*

- **Incremental:** `history.list` with a stored `startHistoryId`. **Caveat:** history IDs expire (roughly a week). If the cursor goes stale or the poller is down too long, fall back to a `messages.list` sweep bounded by `after:` and re-seed the cursor.
- **Content:** walk the MIME tree; store plain text body. **Quote stripping — decided: conservative.** Strip only *trailing* quote blocks and signatures before indexing; inline/interleaved replies survive because stripping stops at the first non-quoted text, and forwards (`Fwd:` subject, forwarded-message headers) are exempted entirely since the quoted content is the payload. For HTML mail (most mail) this is nearly deterministic — Gmail wraps quotes in `<div class="gmail_quote">`/`<blockquote>`; drop those before text extraction. Plain-text-only messages get talon-style heuristics (Mailgun's `talon` or `email-reply-parser`). Low risk on two counts: the quoted text is almost always the body of an earlier message in the same thread, already ingested as its own row; and the raw MIME lives in the CAS, so the normalizer can be re-run if the heuristic needs tuning. Without stripping, every thread is 90% duplicate text and full-text ranking suffers.
- **Attachments:** into the CAS, with extracted text where cheap.
- Backfill of the full mailbox is a batched `messages.list` job; rate limits are the only real constraint.

### 6.3 Android SMS — *medium, needs a push path*

Pull doesn't work here; there's no cloud API. Two complementary paths:

1. **Push (primary, near-real-time):** MacroDroid or Tasker fires an HTTP POST to a new backend route on SMS received/sent — sender, body, timestamp, thread. ~20 minutes of setup, gets latency to seconds. The route is authenticated like everything else (§8); the phone already talks to this backend.
2. **Batch (reconciliation, nightly):** SMS Backup & Restore writes its XML dump to a location the server can read (Syncthing, or upload via the same authenticated API). A nightly Temporal run parses it and upserts. This backfills anything the webhook missed while the phone was offline or the automation was wedged.

Both paths compute the same synthetic `external_id` — hash of (timestamp, counterparty, body) — and the `UNIQUE (channel, external_id)` constraint (§4.2) makes double-writes harmless. The batch job is also the initial full-history import.

### 6.4 Signal — *fiddly but tractable*

- Run Signal Desktop on the server, linked as a secondary device.
- Messages live in a **SQLCipher-encrypted SQLite database**. The schema is reasonably stable across releases; what breaks integrations is the **key storage mechanism**, not key rotation. It moved from a plaintext key in `config.json` to Electron's `safeStorage`, i.e. wrapped by the OS keychain (Keychain / DPAPI / libsecret-kwallet-gnome-keyring). Extraction differs per platform.
- `signalbackup-tools` (bepaald) reads both Desktop's database and encrypted Android backups, and is the pragmatic path for both backfill and ongoing extraction.
- **Operational gotcha:** Signal Desktop holds a lock on the database while running. Always copy the file (plus `-wal`/`-shm`) before reading, and read the copy.
- Expect this connector to need occasional maintenance after Signal Desktop updates. Isolate it so a break doesn't take the pipeline down, and alert on "no new Signal rows in 24h."

### 6.5 Financial transactions — *fiddly*

**Decided: the unofficial Monarch client.** Monarch stays the curation surface (categorization, merchant cleanup, account aggregation), and the connector pulls transactions that are already clean. Known risk: there's no official API, so the client tracks a private endpoint and can break without warning. Treat it like the Signal connector — isolated, staleness-alerted ("no new transactions in 3 days"), never load-bearing for anything else.

- **CSV fallback:** Monarch and most institutions export CSV. A watched drop-folder importer is the backfill path for pre-existing history and the manual stopgap whenever the client breaks.
- **SimpleFIN Bridge** (stable, documented, small subscription) remains the named fallback substrate if the Monarch client ever breaks unrecoverably.

Store `amount` as `numeric`. Normalize merchant strings into a `merchant_normalized` column for grouping; keep the raw string.

---

## 7. Scheduling & operations

- **Cadence:** 15-minute Temporal schedules for Drive, Gmail, Signal, finances (with jitter, matching the existing hunt-schedule pattern). SMS is push + nightly reconciliation. Finances realistically only change a few times a day — 15 minutes is harmless but hourly is plenty.
- **Cursors:** a `sync_state` table — `(source, cursor, last_run_at, last_success_at, last_error)`. Everything about resumability lives in one place; Temporal handles retries and overlap, `sync_state` handles *where to resume from*.
- **Failure isolation:** each connector is its own schedule/workflow. One broken source degrades coverage, never the system.
- **Monitoring:** a simple staleness query — max `ingested_at` per source — surfaced in the morning. Silent connector death is the realistic failure mode, not loud crashes; Temporal's run history helps diagnose, but only the staleness check *detects*.
- **Backups:** the data lake tables ride the existing Postgres backup; the CAS bucket gets versioning or a restic snapshot. See §8 — backups of this data must be encrypted.
- **Secrets:** OAuth refresh tokens and API keys go through the same config/env mechanism as the rest of the backend (`config.ts`). Not in the repo.

---

## 8. Security

This system deliberately creates the juiciest possible target: all email, SMS, Signal, and finances in one queryable store. That deserves more than a secrets bullet.

- **At rest:** full-disk encryption on the host at minimum. If the Postgres instance or S3 bucket is shared with less-sensitive seneschal data, that's fine — the boundary is the box, not the table.
- **Backups are a second copy of everything.** A plaintext `pg_dump` sitting in a sync folder undoes the at-rest story. Use restic (encrypted by default) or encrypt dumps before they leave the machine.
- **SMS push endpoint:** authenticated like every other route — bearer token in the MacroDroid HTTP action, over TLS (or Tailscale if the backend isn't publicly exposed). An unauthenticated ingest endpoint is both a spam vector and a probe target.
- **Signal, explicitly:** extracting Signal messages into plaintext Postgres steps outside Signal's E2E model on purpose. The disappearing-messages expectations of counterparties don't survive this pipeline. Acknowledged trade-off, same one any backup tool makes — but it's a decision, not an accident.
- **Query-time transit:** per §1, retrieved snippets and documents flow through the cloud LLM during queries. Accepted. The controls above are about the store and its copies.
- **Scopes:** all source credentials read-only. The mirror can't be used to modify or delete anything upstream.

---

## 9. Query layer

The LLM gets **tools, not raw SQL** — a new pack in `tools/registry.ts` following the `marketplacePack` pattern, so it's automatically in the catalog for the existing voice/LLM loop. Handlers are user-scoped (they receive `userId`) like every other server tool:

- `search_documents(query, sources?, after?, before?, limit?)` → full-text with ranking, filtered by source and date range.
- `get_document(id)` → full body.
- `query_transactions(after?, before?, merchant?, category?, min_amount?, max_amount?)` → structured filter + aggregates.
- `search_messages(query, channel?, counterparty?, after?, before?)`.
- `timeline(after, before, sources?)` → interleaved chronological view across sources. This is the one that makes "what was going on the week of X" work, and it's the reason a shared `occurred_at` on `documents` matters.

Rationale for tools over free SQL: predictable performance, no destructive statements, and result-size control. If free-form SQL is later wanted, expose it through a read-only role with a statement timeout.

Ranking: `ts_rank_cd` plus a recency tiebreak. Return snippets via `ts_headline`, not full bodies, and let the model call `get_document` when it needs more.

One known granularity limit: `occurred_at` for a Google Doc is its creation time, so a doc heavily *edited* the week of X won't surface in a `timeline` query for that week. Acceptable for v1; if it grates, `timeline` can optionally interleave on `modified_at` too.

---

## 10. Build order

1. Drizzle schema + migration (extensions, tsvector column, indexes), `sync_state`, CAS key convention, and the upsert path. Nothing else works without this.
2. **Drive connector** — highest value, cleanest API, proves the Temporal-schedule shape end to end.
3. **Query tool pack** — register it, get to a working question-and-answer loop early with only one source. Everything after is additive.
4. **Gmail** — biggest volume; will expose ranking and dedup issues that a small corpus hides.
5. **SMS** — authenticated push route first, nightly reconciliation second.
6. **Finances** — unofficial Monarch client; CSV backfill for history.
7. **Signal** — last, because it's the most brittle and the least likely to work unattended.
8. Photos / anything else, once the pattern is boring.

---

## 11. Open questions

None at present. Previously open items and where their resolutions live: document versioning (§2 — latest-only), deletions (§4.4 — keep forever), CAS hosting (§5 — self-hosted MinIO), Gmail quote stripping (§6.2 — conservative, trailing-only), finance feed (§6.5 — unofficial Monarch client), contact identity (§4.3 — seeded + confirmed suggestions), LLM placement (§1/§8 — cloud LLM accepted at query time).

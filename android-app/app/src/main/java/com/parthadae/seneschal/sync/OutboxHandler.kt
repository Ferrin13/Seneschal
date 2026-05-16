package com.parthadae.seneschal.sync

import com.parthadae.seneschal.data.local.PendingMutationEntity
import com.parthadae.seneschal.domain.Activity

/**
 * Pluggable handler for one `kind` of outbox mutation. The SyncWorker groups
 * pending rows by kind and dispatches each batch to the handler whose
 * [kind] matches.
 *
 * Implementations are responsible for deleting successfully-processed rows
 * from the [com.parthadae.seneschal.data.local.PendingMutationDao] themselves,
 * so that partial-success scenarios (e.g. per-row image uploads) can record
 * progress before throwing.
 *
 * Throwing aborts the sync — WorkManager will retry the whole worker per
 * [SyncWorker]'s backoff policy.
 */
interface OutboxHandler {
    /** The `pending_mutations.kind` value this handler claims. */
    val kind: String

    suspend fun push(rows: List<PendingMutationEntity>)

    /**
     * Render this row as a single line for the Settings → Pending changes
     * list. Default falls back to a debug-friendly summary; handlers should
     * override to produce something user-meaningful.
     */
    fun describe(row: PendingMutationEntity, ctx: DescribeContext): String =
        "$kind (${row.targetId ?: "?"})"
}

/**
 * Read-only context passed to [OutboxHandler.describe]. Holds the lookup
 * tables a handler may need to render a friendly summary. Add fields here
 * as new feature areas come online.
 */
data class DescribeContext(
    val activitiesById: Map<String, Activity> = emptyMap(),
)

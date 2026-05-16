package com.parthadae.seneschal.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.parthadae.seneschal.auth.AuthRepository
import com.parthadae.seneschal.data.local.PendingMutationDao
import com.parthadae.seneschal.data.local.PendingMutationEntity
import com.parthadae.seneschal.data.remote.SeneschalApi
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import retrofit2.HttpException

/**
 * Generic sync worker.
 *
 * 1. Verify auth (no-op if signed out).
 * 2. Hit `/me` so the server gets a chance to lazily seed the user.
 * 3. Drain the pending-mutation outbox by dispatching each row to the
 *    [OutboxHandler] whose `kind` matches. Unknown kinds are attempt-
 *    counted and dropped after 5 retries so a stale outbox can never
 *    block a sync forever.
 * 4. Run every bound [Puller] in arbitrary order; each one decides what
 *    "since" cursor to use.
 *
 * Any thrown exception aborts the whole worker; WorkManager retries with
 * the backoff configured in [SyncScheduler].
 */
@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val authRepository: AuthRepository,
    private val api: SeneschalApi,
    private val pendingMutationDao: PendingMutationDao,
    private val outboxHandlers: Set<@JvmSuppressWildcards OutboxHandler>,
    private val pullers: Set<@JvmSuppressWildcards Puller>,
    private val syncStatusRepository: SyncStatusRepository,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        if (authRepository.currentIdToken() == null) {
            return Result.success()
        }
        syncStatusRepository.markStarted()
        return try {
            api.getMe()
            pushOutbox()
            for (puller in pullers) {
                puller.pull()
            }
            syncStatusRepository.markSuccess()
            Result.success()
        } catch (t: Throwable) {
            android.util.Log.w("SyncWorker", "sync failed", t)
            syncStatusRepository.markFailure(describeError(t))
            if (runAttemptCount < 5) Result.retry() else Result.failure()
        }
    }

    /**
     * Build a one-line error string for the Settings screen. For Retrofit
     * [HttpException] we pull the response body too so the user sees the
     * actual server message (e.g. `s3_not_configured`) instead of a bare
     * `HttpException: HTTP 503 Service Unavailable`. The body is capped so
     * a stray HTML error page from a misconfigured proxy can't overflow
     * the row. Reading `errorBody()` consumes it, so the matching
     * [com.parthadae.seneschal.data.remote.HttpErrorLoggingInterceptor]
     * peek logs the same payload to logcat *before* we get here.
     */
    private fun describeError(t: Throwable): String {
        val base = "${t.javaClass.simpleName}: ${t.message ?: ""}"
        if (t !is HttpException) return base
        val body = runCatching {
            t.response()?.errorBody()?.string()?.trim()
        }.getOrNull().orEmpty()
        if (body.isEmpty()) return base
        return "$base — ${body.take(MAX_ERROR_BODY_CHARS)}"
    }

    private suspend fun pushOutbox() {
        val handlersByKind = outboxHandlers.associateBy { it.kind }
        // Track ids we've already touched in *this* sync so an unknown-kind
        // row whose attempt counter we just bumped doesn't immediately come
        // back on the next take().
        val touched = mutableSetOf<Long>()
        while (true) {
            val batch = pendingMutationDao
                .take(MAX_BATCH)
                .filter { it.id !in touched }
            if (batch.isEmpty()) break

            for ((kind, rows) in batch.groupBy { it.kind }) {
                val handler = handlersByKind[kind]
                if (handler != null) {
                    handler.push(rows)
                } else {
                    rows.forEach {
                        markFailed(it, "unknown kind: $kind")
                        touched.add(it.id)
                    }
                }
            }
        }
    }

    private suspend fun markFailed(row: PendingMutationEntity, message: String) {
        if (row.attemptCount >= 5) {
            pendingMutationDao.delete(row.id)
        } else {
            pendingMutationDao.update(
                row.copy(
                    attemptCount = row.attemptCount + 1,
                    lastAttemptAt = System.currentTimeMillis(),
                    lastError = message,
                )
            )
        }
    }

    companion object {
        private const val MAX_BATCH = 200
        private const val MAX_ERROR_BODY_CHARS = 500
    }
}

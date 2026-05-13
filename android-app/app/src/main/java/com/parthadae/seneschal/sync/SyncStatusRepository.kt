package com.parthadae.seneschal.sync

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

data class SyncStatus(
    val lastAttemptAtMs: Long? = null,
    val lastSuccessAtMs: Long? = null,
    val lastError: String? = null,
    val running: Boolean = false,
)

/**
 * Tiny in-memory store that the SyncWorker writes to and the Settings
 * screen reads from. Process-scoped is fine: it's a debugging aid, not
 * a feature that needs to survive a kill.
 */
@Singleton
class SyncStatusRepository @Inject constructor() {
    private val _status = MutableStateFlow(SyncStatus())
    val status: StateFlow<SyncStatus> = _status.asStateFlow()

    fun markStarted() {
        _status.value = _status.value.copy(running = true, lastAttemptAtMs = System.currentTimeMillis())
    }

    fun markSuccess() {
        val now = System.currentTimeMillis()
        _status.value = _status.value.copy(
            running = false,
            lastSuccessAtMs = now,
            lastAttemptAtMs = now,
            lastError = null,
        )
    }

    fun markFailure(error: String) {
        _status.value = _status.value.copy(
            running = false,
            lastError = error,
            lastAttemptAtMs = System.currentTimeMillis(),
        )
    }
}

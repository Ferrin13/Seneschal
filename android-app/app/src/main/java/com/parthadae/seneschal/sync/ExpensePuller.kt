package com.parthadae.seneschal.sync

import com.parthadae.seneschal.data.local.ExpenseDao
import com.parthadae.seneschal.data.local.ExpenseEntity
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.parthadae.seneschal.data.remote.dto.ExpenseDto
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Incremental pull of expenses filtered by `since = max(updatedAt)`.
 * `localImagePath` is intentionally cleared on incoming rows: anything
 * the server told us about is, by definition, no longer waiting for an
 * upload from this device.
 */
@Singleton
class ExpensePuller @Inject constructor(
    private val api: SeneschalApi,
    private val expenseDao: ExpenseDao,
) : Puller {
    // Expenses FK into businesses, so run after BusinessPuller.
    override val order: Int = Puller.ORDER_DEPENDENT

    override suspend fun pull() {
        val since = expenseDao.maxUpdatedAt()?.let { Instant.ofEpochMilli(it).toString() }
        val rows = api.getExpenses(since = since)
        if (rows.isNotEmpty()) expenseDao.upsertAll(rows.mapNotNull { it.toEntity() })
    }

    private fun ExpenseDto.toEntity(): ExpenseEntity? {
        // A non-deleted server row should always carry a businessId and
        // occurredAt — but defend against partial migrations / future
        // schema drift by skipping rows that don't.
        if (deletedAt == null) {
            if (businessId == null || occurredAt == null) return null
        }
        return ExpenseEntity(
            id = id,
            businessId = businessId ?: "",
            occurredAtMs = occurredAt?.let { Instant.parse(it).toEpochMilli() } ?: 0L,
            amountCents = amountCents,
            note = note,
            imageKey = imageKey,
            localImagePath = null,
            createdAt = Instant.parse(createdAt).toEpochMilli(),
            updatedAt = Instant.parse(updatedAt).toEpochMilli(),
            clientUpdatedAt = Instant.parse(clientUpdatedAt).toEpochMilli(),
            deletedAt = deletedAt?.let { Instant.parse(it).toEpochMilli() },
        )
    }
}

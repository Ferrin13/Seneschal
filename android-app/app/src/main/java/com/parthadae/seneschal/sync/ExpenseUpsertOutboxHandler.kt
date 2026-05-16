package com.parthadae.seneschal.sync

import com.parthadae.seneschal.data.local.PendingMutationDao
import com.parthadae.seneschal.data.local.PendingMutationEntity
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.parthadae.seneschal.data.remote.dto.ExpenseUpsertDto
import com.parthadae.seneschal.data.remote.dto.ExpensesUpsertRequest
import com.parthadae.seneschal.data.repository.ExpenseRepository
import com.squareup.moshi.Moshi
import com.squareup.moshi.adapter
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Pushes queued [ExpenseUpsertDto]s to `PUT /expenses` in one bulk request.
 * The server applies last-write-wins by `clientUpdatedAt`.
 */
@OptIn(ExperimentalStdlibApi::class)
@Singleton
class ExpenseUpsertOutboxHandler @Inject constructor(
    private val api: SeneschalApi,
    private val pendingMutationDao: PendingMutationDao,
    moshi: Moshi,
) : OutboxHandler {
    private val adapter = moshi.adapter<ExpenseUpsertDto>()

    override val kind: String = ExpenseRepository.KIND_EXPENSE_UPSERT

    override suspend fun push(rows: List<PendingMutationEntity>) {
        if (rows.isEmpty()) return
        val payload = rows.mapNotNull {
            runCatching { adapter.fromJson(it.payloadJson) }.getOrNull()
        }
        if (payload.isNotEmpty()) {
            api.upsertExpenses(ExpensesUpsertRequest(payload))
        }
        rows.forEach { pendingMutationDao.delete(it.id) }
    }

    override fun describe(row: PendingMutationEntity, ctx: DescribeContext): String {
        val parsed = runCatching { adapter.fromJson(row.payloadJson) }.getOrNull()
            ?: return "Expense change (${row.targetId ?: "?"})"
        return when {
            parsed.deleted == true -> "Delete expense"
            else -> {
                val dateLabel = parsed.occurredAt?.let { formatDateTime(it) } ?: ""
                buildString {
                    append("Save expense")
                    if (dateLabel.isNotEmpty()) append(" · $dateLabel")
                    if (parsed.amountCents != null) append(" · ${formatAmount(parsed.amountCents)}")
                }
            }
        }
    }

    companion object {
        private val TIME_FMT = DateTimeFormatter.ofPattern("h:mm a")

        private fun formatDateTime(iso: String): String = runCatching {
            val instant = Instant.parse(iso)
            val local: LocalDateTime = instant.atZone(ZoneId.systemDefault()).toLocalDateTime()
            val date = local.toLocalDate()
            val today = LocalDate.now()
            val day = when (date) {
                today -> "Today"
                today.minusDays(1) -> "Yesterday"
                today.plusDays(1) -> "Tomorrow"
                else -> DateTimeFormatter.ofPattern("EEE MMM d").format(date)
            }
            "$day ${TIME_FMT.format(local)}"
        }.getOrElse { iso }

        private fun formatAmount(cents: Int): String {
            val dollars = cents / 100
            val rem = (if (cents < 0) -cents else cents) % 100
            val sign = if (cents < 0) "-" else ""
            return "$sign$$dollars.${rem.toString().padStart(2, '0')}"
        }
    }
}

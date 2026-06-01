package com.parthadae.seneschal.sync

import com.parthadae.seneschal.data.local.PendingMutationDao
import com.parthadae.seneschal.data.local.PendingMutationEntity
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.parthadae.seneschal.data.remote.dto.MessageTemplateUpsertDto
import com.parthadae.seneschal.data.remote.dto.MessageTemplatesUpsertRequest
import com.parthadae.seneschal.data.repository.MessageTemplateRepository
import com.squareup.moshi.Moshi
import com.squareup.moshi.adapter
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Pushes queued [MessageTemplateUpsertDto]s to `PUT /message-templates` in
 * one bulk request. Server applies LWW by `clientUpdatedAt`.
 */
@OptIn(ExperimentalStdlibApi::class)
@Singleton
class MessageTemplateUpsertOutboxHandler @Inject constructor(
    private val api: SeneschalApi,
    private val pendingMutationDao: PendingMutationDao,
    moshi: Moshi,
) : OutboxHandler {
    private val adapter = moshi.adapter<MessageTemplateUpsertDto>()

    override val kind: String = MessageTemplateRepository.KIND_TEMPLATE_UPSERT

    override suspend fun push(rows: List<PendingMutationEntity>) {
        if (rows.isEmpty()) return
        val payload = rows.mapNotNull {
            runCatching { adapter.fromJson(it.payloadJson) }.getOrNull()
        }
        if (payload.isNotEmpty()) {
            api.upsertMessageTemplates(MessageTemplatesUpsertRequest(payload))
        }
        rows.forEach { pendingMutationDao.delete(it.id) }
    }

    override fun describe(row: PendingMutationEntity, ctx: DescribeContext): String {
        val parsed = runCatching { adapter.fromJson(row.payloadJson) }.getOrNull()
            ?: return "Template change (${row.targetId ?: "?"})"
        return when {
            parsed.deleted == true -> "Delete template"
            !parsed.title.isNullOrBlank() -> "Save template · ${parsed.title}"
            else -> "Save template"
        }
    }
}

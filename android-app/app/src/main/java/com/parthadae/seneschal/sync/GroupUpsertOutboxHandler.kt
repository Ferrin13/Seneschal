package com.parthadae.seneschal.sync

import com.parthadae.seneschal.data.local.PendingMutationDao
import com.parthadae.seneschal.data.local.PendingMutationEntity
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.parthadae.seneschal.data.remote.dto.GroupUpsertDto
import com.parthadae.seneschal.data.remote.dto.GroupsUpsertRequest
import com.parthadae.seneschal.data.repository.GroupRepository
import com.squareup.moshi.Moshi
import com.squareup.moshi.adapter
import javax.inject.Inject
import javax.inject.Singleton

@OptIn(ExperimentalStdlibApi::class)
@Singleton
class GroupUpsertOutboxHandler @Inject constructor(
    private val api: SeneschalApi,
    private val pendingMutationDao: PendingMutationDao,
    moshi: Moshi,
) : OutboxHandler {
    private val adapter = moshi.adapter<GroupUpsertDto>()

    override val kind: String = GroupRepository.KIND_GROUP_UPSERT

    override suspend fun push(rows: List<PendingMutationEntity>) {
        if (rows.isEmpty()) return
        val payload = rows.mapNotNull {
            runCatching { adapter.fromJson(it.payloadJson) }.getOrNull()
        }
        if (payload.isNotEmpty()) {
            api.upsertGroups(GroupsUpsertRequest(payload))
        }
        rows.forEach { pendingMutationDao.delete(it.id) }
    }

    override fun describe(row: PendingMutationEntity, ctx: DescribeContext): String {
        val parsed = runCatching { adapter.fromJson(row.payloadJson) }.getOrNull()
            ?: return "Group change (${row.targetId ?: "?"})"
        return when {
            parsed.deleted == true -> "Delete group"
            !parsed.name.isNullOrBlank() -> "Save group · ${parsed.name}"
            else -> "Save group"
        }
    }
}

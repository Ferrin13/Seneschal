package com.parthadae.seneschal.sync

import com.parthadae.seneschal.data.local.PendingMutationDao
import com.parthadae.seneschal.data.local.PendingMutationEntity
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.parthadae.seneschal.data.remote.dto.GroupMemberUpsertDto
import com.parthadae.seneschal.data.remote.dto.GroupMembersUpsertRequest
import com.parthadae.seneschal.data.repository.GroupMemberRepository
import com.squareup.moshi.Moshi
import com.squareup.moshi.adapter
import javax.inject.Inject
import javax.inject.Singleton

@OptIn(ExperimentalStdlibApi::class)
@Singleton
class GroupMemberUpsertOutboxHandler @Inject constructor(
    private val api: SeneschalApi,
    private val pendingMutationDao: PendingMutationDao,
    moshi: Moshi,
) : OutboxHandler {
    private val adapter = moshi.adapter<GroupMemberUpsertDto>()

    override val kind: String = GroupMemberRepository.KIND_GROUP_MEMBER_UPSERT

    override suspend fun push(rows: List<PendingMutationEntity>) {
        if (rows.isEmpty()) return
        val payload = rows.mapNotNull {
            runCatching { adapter.fromJson(it.payloadJson) }.getOrNull()
        }
        if (payload.isNotEmpty()) {
            api.upsertGroupMembers(GroupMembersUpsertRequest(payload))
        }
        rows.forEach { pendingMutationDao.delete(it.id) }
    }

    override fun describe(row: PendingMutationEntity, ctx: DescribeContext): String {
        val parsed = runCatching { adapter.fromJson(row.payloadJson) }.getOrNull()
            ?: return "Member change (${row.targetId ?: "?"})"
        return when {
            parsed.deleted == true -> "Remove group member"
            !parsed.displayName.isNullOrBlank() -> "Save member · ${parsed.displayName}"
            else -> "Save member"
        }
    }
}

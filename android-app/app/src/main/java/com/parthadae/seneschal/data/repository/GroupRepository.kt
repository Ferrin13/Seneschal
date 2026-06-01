package com.parthadae.seneschal.data.repository

import com.parthadae.seneschal.data.local.GroupDao
import com.parthadae.seneschal.data.local.GroupEntity
import com.parthadae.seneschal.data.local.GroupMemberDao
import com.parthadae.seneschal.data.local.PendingMutationDao
import com.parthadae.seneschal.data.local.PendingMutationEntity
import com.parthadae.seneschal.data.remote.dto.GroupUpsertDto
import com.parthadae.seneschal.domain.Group
import com.parthadae.seneschal.domain.GroupSummary
import com.parthadae.seneschal.domain.toDomain
import com.parthadae.seneschal.sync.SyncScheduler
import com.squareup.moshi.Moshi
import com.squareup.moshi.adapter
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Offline-first store for the groups themselves. Members live in
 * [GroupMemberRepository]; this repo also exposes a joined `groupSummaries`
 * flow that pairs each group with its current active-member count for the
 * groups list screen.
 *
 * Outbox ordering note: when a brand-new group is created together with
 * members, the group upsert is enqueued first so the server-side group row
 * exists before the member rows reference it. If the member batch
 * nevertheless lands first the server returns 4xx and SyncWorker retries
 * on the next tick — eventually consistent.
 */
@OptIn(ExperimentalStdlibApi::class)
@Singleton
class GroupRepository @Inject constructor(
    private val groupDao: GroupDao,
    private val groupMemberDao: GroupMemberDao,
    private val pendingMutationDao: PendingMutationDao,
    private val syncScheduler: SyncScheduler,
    moshi: Moshi,
) {
    private val upsertAdapter = moshi.adapter<GroupUpsertDto>()

    val groups: Flow<List<Group>> =
        groupDao.observeActive().map { list -> list.map { it.toDomain() } }

    val groupSummaries: Flow<List<GroupSummary>> =
        groupDao.observeActive().combine(groupMemberDao.observeMemberCounts()) { groups, counts ->
            val countById = counts.associate { it.groupId to it.count }
            groups.map { g -> GroupSummary(g.toDomain(), countById[g.id] ?: 0) }
        }

    suspend fun byId(id: String): Group? = groupDao.byId(id)?.toDomain()

    suspend fun upsert(
        id: String = UUID.randomUUID().toString(),
        name: String,
    ): String {
        val now = System.currentTimeMillis()
        val existing = groupDao.byId(id)
        val entity = GroupEntity(
            id = id,
            name = name,
            createdAt = existing?.createdAt ?: now,
            updatedAt = now,
            clientUpdatedAt = now,
            deletedAt = null,
        )
        groupDao.upsertAll(listOf(entity))
        enqueueUpsert(
            GroupUpsertDto(
                id = id,
                name = name,
                clientUpdatedAt = Instant.ofEpochMilli(now).toString(),
            )
        )
        return id
    }

    /**
     * Soft-delete the group locally (so the FK from group_members stays
     * valid) and tombstone it on the server via the outbox. We do NOT
     * touch member rows here; the user's existing members are left alone
     * and will be filtered out of the groups list by `observeActive()`'s
     * `deletedAt IS NULL` clause.
     */
    suspend fun delete(id: String) {
        val now = System.currentTimeMillis()
        groupDao.softDeleteById(
            id = id,
            deletedAtMs = now,
            clientUpdatedAtMs = now,
            updatedAtMs = now,
        )
        enqueueUpsert(
            GroupUpsertDto(
                id = id,
                name = null,
                clientUpdatedAt = Instant.ofEpochMilli(now).toString(),
                deleted = true,
            )
        )
    }

    private suspend fun enqueueUpsert(dto: GroupUpsertDto) {
        pendingMutationDao.insert(
            PendingMutationEntity(
                kind = KIND_GROUP_UPSERT,
                targetId = dto.id,
                payloadJson = upsertAdapter.toJson(dto),
                createdAt = System.currentTimeMillis(),
            )
        )
        syncScheduler.requestImmediateSync()
    }

    companion object {
        const val KIND_GROUP_UPSERT = "group_upsert"
    }
}

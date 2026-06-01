package com.parthadae.seneschal.data.repository

import com.parthadae.seneschal.data.local.GroupMemberDao
import com.parthadae.seneschal.data.local.GroupMemberEntity
import com.parthadae.seneschal.data.local.PendingMutationDao
import com.parthadae.seneschal.data.local.PendingMutationEntity
import com.parthadae.seneschal.data.remote.dto.GroupMemberUpsertDto
import com.parthadae.seneschal.domain.GroupMember
import com.parthadae.seneschal.domain.toDomain
import com.parthadae.seneschal.sync.SyncScheduler
import com.squareup.moshi.Moshi
import com.squareup.moshi.adapter
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Offline-first store for the contacts inside a group. Members are
 * snapshotted (display name + phone number copied locally rather than
 * re-read from system Contacts every send) so the feature keeps working
 * without contacts permission.
 */
@OptIn(ExperimentalStdlibApi::class)
@Singleton
class GroupMemberRepository @Inject constructor(
    private val groupMemberDao: GroupMemberDao,
    private val pendingMutationDao: PendingMutationDao,
    private val syncScheduler: SyncScheduler,
    moshi: Moshi,
) {
    private val upsertAdapter = moshi.adapter<GroupMemberUpsertDto>()

    fun observeForGroup(groupId: String): Flow<List<GroupMember>> =
        groupMemberDao.observeForGroup(groupId).map { list -> list.map { it.toDomain() } }

    suspend fun forGroup(groupId: String): List<GroupMember> =
        groupMemberDao.forGroup(groupId).map { it.toDomain() }

    suspend fun upsert(
        id: String = UUID.randomUUID().toString(),
        groupId: String,
        displayName: String,
        phoneNumber: String,
        contactLookupKey: String? = null,
    ): String {
        val now = System.currentTimeMillis()
        val existing = groupMemberDao.byId(id)
        val entity = GroupMemberEntity(
            id = id,
            groupId = groupId,
            displayName = displayName,
            phoneNumber = phoneNumber,
            contactLookupKey = contactLookupKey,
            createdAt = existing?.createdAt ?: now,
            updatedAt = now,
            clientUpdatedAt = now,
            deletedAt = null,
        )
        groupMemberDao.upsertAll(listOf(entity))
        enqueueUpsert(
            GroupMemberUpsertDto(
                id = id,
                groupId = groupId,
                displayName = displayName,
                phoneNumber = phoneNumber,
                contactLookupKey = contactLookupKey,
                clientUpdatedAt = Instant.ofEpochMilli(now).toString(),
            )
        )
        return id
    }

    suspend fun delete(id: String) {
        val now = System.currentTimeMillis()
        groupMemberDao.deleteById(id)
        enqueueUpsert(
            GroupMemberUpsertDto(
                id = id,
                groupId = null,
                displayName = null,
                phoneNumber = null,
                contactLookupKey = null,
                clientUpdatedAt = Instant.ofEpochMilli(now).toString(),
                deleted = true,
            )
        )
    }

    private suspend fun enqueueUpsert(dto: GroupMemberUpsertDto) {
        pendingMutationDao.insert(
            PendingMutationEntity(
                kind = KIND_GROUP_MEMBER_UPSERT,
                targetId = dto.id,
                payloadJson = upsertAdapter.toJson(dto),
                createdAt = System.currentTimeMillis(),
            )
        )
        syncScheduler.requestImmediateSync()
    }

    companion object {
        const val KIND_GROUP_MEMBER_UPSERT = "group_member_upsert"
    }
}

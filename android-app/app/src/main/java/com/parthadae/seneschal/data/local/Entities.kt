package com.parthadae.seneschal.data.local

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Local mirror of the server schema. We keep server IDs as primary keys so
 * round-tripping through sync is a straight upsert. Locally-created rows
 * use a client-generated UUID until the server returns one (TODO: handle
 * that swap in the sync worker; for v1 we create on the server first).
 */
@Entity(tableName = "categories")
data class CategoryEntity(
    @PrimaryKey val id: String,
    val name: String,
    val kind: String,
    val color: String,
    val sortOrder: Int,
    val isActive: Boolean,
    val createdAt: Long,
    val updatedAt: Long,
    val clientUpdatedAt: Long,
    val deletedAt: Long?,
)

@Entity(
    tableName = "activities",
    foreignKeys = [
        ForeignKey(
            entity = CategoryEntity::class,
            parentColumns = ["id"],
            childColumns = ["categoryId"],
            onDelete = ForeignKey.NO_ACTION,
        )
    ],
    indices = [Index("categoryId")],
)
data class ActivityEntity(
    @PrimaryKey val id: String,
    val categoryId: String,
    val name: String,
    val sortOrder: Int,
    val isActive: Boolean,
    val archivedAt: Long?,
    val createdAt: Long,
    val updatedAt: Long,
    val clientUpdatedAt: Long,
    val deletedAt: Long?,
)

/**
 * Composite PK on slot start (epoch millis at a 15-min boundary).
 */
@Entity(
    tableName = "time_slots",
    primaryKeys = ["slotStartUtcMs"],
    indices = [Index("primaryActivityId"), Index("updatedAt")],
)
data class TimeSlotEntity(
    val slotStartUtcMs: Long,
    val primaryActivityId: String?,
    val secondaryActivityId: String?,
    val notes: String?,
    val updatedAt: Long,
    val clientUpdatedAt: Long,
    val deletedAt: Long?,
)

@Entity(tableName = "running_timer")
data class RunningTimerEntity(
    @PrimaryKey @ColumnInfo(name = "id") val id: Int = 1,
    val primaryActivityId: String,
    val secondaryActivityId: String?,
    val notes: String?,
    val startedAtMs: Long,
)

/**
 * Outbox for offline writes. The sync worker drains this in FIFO order.
 * `payloadJson` is the JSON body of the mutation; `kind` selects how the
 * worker should ship it.
 */
@Entity(tableName = "pending_mutations")
data class PendingMutationEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val kind: String, // "slot_upsert", "category_create", etc.
    val targetId: String?, // server id or slot epoch ms (as string)
    val payloadJson: String,
    val createdAt: Long,
    val attemptCount: Int = 0,
    val lastAttemptAt: Long? = null,
    val lastError: String? = null,
)

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

/**
 * The fixed list of "businesses" an expense can be tagged with. Modeled
 * as a table (not a hard-coded enum) so the seed list can change without
 * a schema migration; the UI treats it as read-only.
 */
@Entity(tableName = "businesses")
data class BusinessEntity(
    @PrimaryKey val id: String,
    val name: String,
    val sortOrder: Int,
    val isActive: Boolean,
    val createdAt: Long,
    val updatedAt: Long,
    val clientUpdatedAt: Long,
    val deletedAt: Long?,
)

/**
 * One expense entry. Required: a business and a calendar date. Optional:
 * dollar amount (stored in cents to avoid float drift), free-form note,
 * and a single attached image.
 *
 * `imageKey` is the S3 object key once the image is uploaded.
 * `localImagePath` is the absolute path of the image file inside this
 * app's `filesDir` while it's queued for upload; it stays populated until
 * the upload succeeds and the key is written back, after which the local
 * copy may be deleted.
 *
 * `occurredAtMs` is the wall-clock moment of the expense as epoch
 * milliseconds. It corresponds to a `timestamp with time zone` column
 * server-side; we store an Instant locally so date+time both round-trip.
 */
@Entity(
    tableName = "expenses",
    foreignKeys = [
        ForeignKey(
            entity = BusinessEntity::class,
            parentColumns = ["id"],
            childColumns = ["businessId"],
            onDelete = ForeignKey.NO_ACTION,
        )
    ],
    indices = [Index("businessId"), Index("occurredAtMs"), Index("updatedAt")],
)
data class ExpenseEntity(
    @PrimaryKey val id: String,
    val businessId: String,
    val occurredAtMs: Long,
    val amountCents: Int?,
    val note: String?,
    val imageKey: String?,
    val localImagePath: String?,
    val createdAt: Long,
    val updatedAt: Long,
    val clientUpdatedAt: Long,
    val deletedAt: Long?,
)

/**
 * Reusable plain-text message body the user can pick when launching a
 * group send. v1 stores the body verbatim with no variable interpolation.
 * Synced offline-first using the same client_updated_at LWW pattern as
 * expenses.
 */
@Entity(
    tableName = "message_templates",
    indices = [Index("updatedAt")],
)
data class MessageTemplateEntity(
    @PrimaryKey val id: String,
    val title: String,
    val body: String,
    val createdAt: Long,
    val updatedAt: Long,
    val clientUpdatedAt: Long,
    val deletedAt: Long?,
)

/**
 * A named bag of contacts the user can target with a send. Members live
 * in `group_members` and reference this row's id. Soft-deleted via
 * `deletedAt`; we never hard-delete a group locally, since the FK from
 * group_members points back here.
 */
@Entity(
    tableName = "groups",
    indices = [Index("updatedAt")],
)
data class GroupEntity(
    @PrimaryKey val id: String,
    val name: String,
    val createdAt: Long,
    val updatedAt: Long,
    val clientUpdatedAt: Long,
    val deletedAt: Long?,
)

/**
 * One contact (snapshotted display name + phone number) within a group.
 * We snapshot rather than re-reading from the system Contacts provider on
 * every send so messaging still works if the contact changes or the user
 * revokes contacts access. `contactLookupKey` is retained so we can
 * re-pick the same contact later if desired.
 */
@Entity(
    tableName = "group_members",
    foreignKeys = [
        ForeignKey(
            entity = GroupEntity::class,
            parentColumns = ["id"],
            childColumns = ["groupId"],
            onDelete = ForeignKey.NO_ACTION,
        )
    ],
    indices = [Index("groupId"), Index("updatedAt")],
)
data class GroupMemberEntity(
    @PrimaryKey val id: String,
    val groupId: String,
    val displayName: String,
    val phoneNumber: String,
    val contactLookupKey: String?,
    val createdAt: Long,
    val updatedAt: Long,
    val clientUpdatedAt: Long,
    val deletedAt: Long?,
)

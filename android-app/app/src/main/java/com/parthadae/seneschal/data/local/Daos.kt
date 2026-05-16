package com.parthadae.seneschal.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface CategoryDao {
    @Query("SELECT * FROM categories WHERE deletedAt IS NULL ORDER BY sortOrder, name")
    fun observeActive(): Flow<List<CategoryEntity>>

    @Query("SELECT * FROM categories WHERE id = :id LIMIT 1")
    suspend fun byId(id: String): CategoryEntity?

    @Query("SELECT MAX(updatedAt) FROM categories")
    suspend fun maxUpdatedAt(): Long?

    @Upsert
    suspend fun upsertAll(rows: List<CategoryEntity>)

    @Query("DELETE FROM categories")
    suspend fun clear()

    /**
     * Hard-delete any local categories whose id is not in [keepIds]. Used
     * by the sync reconcile pass to evict rows that no longer exist on the
     * server (e.g. after a manual re-id of the prod DB).
     */
    @Query("DELETE FROM categories WHERE id NOT IN (:keepIds)")
    suspend fun deleteWhereIdNotIn(keepIds: List<String>)
}

@Dao
interface ActivityDao {
    @Query("SELECT * FROM activities WHERE deletedAt IS NULL AND archivedAt IS NULL ORDER BY sortOrder, name")
    fun observeActive(): Flow<List<ActivityEntity>>

    @Query("SELECT * FROM activities WHERE deletedAt IS NULL ORDER BY sortOrder, name")
    fun observeAllIncludingArchived(): Flow<List<ActivityEntity>>

    @Query("SELECT * FROM activities WHERE id = :id LIMIT 1")
    suspend fun byId(id: String): ActivityEntity?

    @Query("SELECT MAX(updatedAt) FROM activities")
    suspend fun maxUpdatedAt(): Long?

    @Upsert
    suspend fun upsertAll(rows: List<ActivityEntity>)

    @Query("DELETE FROM activities")
    suspend fun clear()

    /**
     * Hard-delete any local activities whose id is not in [keepIds]. Used
     * by the sync reconcile pass to evict rows that no longer exist on the
     * server (e.g. after a manual re-id of the prod DB).
     */
    @Query("DELETE FROM activities WHERE id NOT IN (:keepIds)")
    suspend fun deleteWhereIdNotIn(keepIds: List<String>)
}

@Dao
interface TimeSlotDao {
    @Query(
        "SELECT * FROM time_slots WHERE slotStartUtcMs >= :fromMs AND slotStartUtcMs < :toMs " +
            "AND deletedAt IS NULL ORDER BY slotStartUtcMs"
    )
    fun observeRange(fromMs: Long, toMs: Long): Flow<List<TimeSlotEntity>>

    @Query("SELECT * FROM time_slots WHERE slotStartUtcMs = :slotStartMs LIMIT 1")
    suspend fun byStart(slotStartMs: Long): TimeSlotEntity?

    @Query("SELECT * FROM time_slots WHERE slotStartUtcMs IN (:slotStartMs)")
    suspend fun findByStarts(slotStartMs: List<Long>): List<TimeSlotEntity>

    @Query("SELECT MAX(updatedAt) FROM time_slots")
    suspend fun maxUpdatedAt(): Long?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(rows: List<TimeSlotEntity>)

    @Query("DELETE FROM time_slots WHERE slotStartUtcMs = :slotStartMs")
    suspend fun deleteByStart(slotStartMs: Long)

    @Query(
        "SELECT primaryActivityId AS activityId, MAX(updatedAt) AS lastUsedMs FROM time_slots " +
            "WHERE primaryActivityId IS NOT NULL AND deletedAt IS NULL " +
            "GROUP BY primaryActivityId ORDER BY lastUsedMs DESC LIMIT :limit"
    )
    fun observeRecentActivities(limit: Int): Flow<List<RecentActivity>>

    @Query(
        "SELECT notes FROM time_slots " +
            "WHERE notes IS NOT NULL AND TRIM(notes) != '' AND deletedAt IS NULL " +
            "GROUP BY notes ORDER BY MAX(updatedAt) DESC LIMIT :limit"
    )
    fun observeRecentNotes(limit: Int): Flow<List<String>>
}

data class RecentActivity(val activityId: String, val lastUsedMs: Long)

@Dao
interface RunningTimerDao {
    @Query("SELECT * FROM running_timer WHERE id = 1 LIMIT 1")
    fun observe(): Flow<RunningTimerEntity?>

    @Query("SELECT * FROM running_timer WHERE id = 1 LIMIT 1")
    suspend fun current(): RunningTimerEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(row: RunningTimerEntity)

    @Query("DELETE FROM running_timer")
    suspend fun clear()
}

@Dao
interface BusinessDao {
    @Query("SELECT * FROM businesses WHERE deletedAt IS NULL ORDER BY sortOrder, name")
    fun observeActive(): Flow<List<BusinessEntity>>

    @Query("SELECT * FROM businesses WHERE id = :id LIMIT 1")
    suspend fun byId(id: String): BusinessEntity?

    @Upsert
    suspend fun upsertAll(rows: List<BusinessEntity>)

    @Query("DELETE FROM businesses WHERE id NOT IN (:keepIds)")
    suspend fun deleteWhereIdNotIn(keepIds: List<String>)
}

@Dao
interface ExpenseDao {
    @Query("SELECT * FROM expenses WHERE deletedAt IS NULL ORDER BY occurredAtMs DESC, createdAt DESC")
    fun observeActive(): Flow<List<ExpenseEntity>>

    @Query("SELECT * FROM expenses WHERE id = :id LIMIT 1")
    suspend fun byId(id: String): ExpenseEntity?

    @Query("SELECT MAX(updatedAt) FROM expenses")
    suspend fun maxUpdatedAt(): Long?

    @Upsert
    suspend fun upsertAll(rows: List<ExpenseEntity>)

    @Query("DELETE FROM expenses WHERE id = :id")
    suspend fun deleteById(id: String)

    /**
     * Patch just the image fields. Used by the image-upload outbox handler
     * so a successful upload can attach the resolved S3 key without
     * racing the user's other edits to the row.
     */
    @Query(
        "UPDATE expenses SET imageKey = :imageKey, localImagePath = :localImagePath, " +
            "updatedAt = :updatedAt, clientUpdatedAt = :clientUpdatedAt " +
            "WHERE id = :id"
    )
    suspend fun setImage(
        id: String,
        imageKey: String?,
        localImagePath: String?,
        updatedAt: Long,
        clientUpdatedAt: Long,
    )
}

@Dao
interface PendingMutationDao {
    @Query("SELECT * FROM pending_mutations ORDER BY id ASC LIMIT :limit")
    suspend fun take(limit: Int): List<PendingMutationEntity>

    @Query("SELECT * FROM pending_mutations ORDER BY id ASC")
    fun observeAll(): Flow<List<PendingMutationEntity>>

    @Insert
    suspend fun insert(row: PendingMutationEntity): Long

    @Query("DELETE FROM pending_mutations WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("DELETE FROM pending_mutations")
    suspend fun clear()

    @Update
    suspend fun update(row: PendingMutationEntity)

    @Query("SELECT COUNT(*) FROM pending_mutations")
    fun observeCount(): Flow<Int>
}

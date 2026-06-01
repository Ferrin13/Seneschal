package com.parthadae.seneschal.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [
        CategoryEntity::class,
        ActivityEntity::class,
        TimeSlotEntity::class,
        RunningTimerEntity::class,
        PendingMutationEntity::class,
        BusinessEntity::class,
        ExpenseEntity::class,
        MessageTemplateEntity::class,
        GroupEntity::class,
        GroupMemberEntity::class,
    ],
    version = 6,
    exportSchema = false,
)
abstract class SeneschalDatabase : RoomDatabase() {
    abstract fun categoryDao(): CategoryDao
    abstract fun activityDao(): ActivityDao
    abstract fun timeSlotDao(): TimeSlotDao
    abstract fun runningTimerDao(): RunningTimerDao
    abstract fun pendingMutationDao(): PendingMutationDao
    abstract fun businessDao(): BusinessDao
    abstract fun expenseDao(): ExpenseDao
    abstract fun messageTemplateDao(): MessageTemplateDao
    abstract fun groupDao(): GroupDao
    abstract fun groupMemberDao(): GroupMemberDao
}

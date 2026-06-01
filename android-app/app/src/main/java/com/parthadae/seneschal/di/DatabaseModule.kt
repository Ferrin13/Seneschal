package com.parthadae.seneschal.di

import android.content.Context
import androidx.room.Room
import com.parthadae.seneschal.data.local.ActivityDao
import com.parthadae.seneschal.data.local.BusinessDao
import com.parthadae.seneschal.data.local.CategoryDao
import com.parthadae.seneschal.data.local.ExpenseDao
import com.parthadae.seneschal.data.local.GroupDao
import com.parthadae.seneschal.data.local.GroupMemberDao
import com.parthadae.seneschal.data.local.MIGRATION_3_4
import com.parthadae.seneschal.data.local.MIGRATION_4_5
import com.parthadae.seneschal.data.local.MIGRATION_5_6
import com.parthadae.seneschal.data.local.MessageTemplateDao
import com.parthadae.seneschal.data.local.PendingMutationDao
import com.parthadae.seneschal.data.local.RunningTimerDao
import com.parthadae.seneschal.data.local.SeneschalDatabase
import com.parthadae.seneschal.data.local.TimeSlotDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {
    @Provides
    @Singleton
    fun database(@ApplicationContext context: Context): SeneschalDatabase =
        Room.databaseBuilder(context, SeneschalDatabase::class.java, "seneschal.db")
            .addMigrations(MIGRATION_3_4, MIGRATION_4_5, MIGRATION_5_6)
            .build()

    @Provides fun categoryDao(db: SeneschalDatabase): CategoryDao = db.categoryDao()
    @Provides fun activityDao(db: SeneschalDatabase): ActivityDao = db.activityDao()
    @Provides fun timeSlotDao(db: SeneschalDatabase): TimeSlotDao = db.timeSlotDao()
    @Provides fun runningTimerDao(db: SeneschalDatabase): RunningTimerDao = db.runningTimerDao()
    @Provides fun pendingMutationDao(db: SeneschalDatabase): PendingMutationDao =
        db.pendingMutationDao()
    @Provides fun businessDao(db: SeneschalDatabase): BusinessDao = db.businessDao()
    @Provides fun expenseDao(db: SeneschalDatabase): ExpenseDao = db.expenseDao()
    @Provides fun messageTemplateDao(db: SeneschalDatabase): MessageTemplateDao =
        db.messageTemplateDao()
    @Provides fun groupDao(db: SeneschalDatabase): GroupDao = db.groupDao()
    @Provides fun groupMemberDao(db: SeneschalDatabase): GroupMemberDao = db.groupMemberDao()
}

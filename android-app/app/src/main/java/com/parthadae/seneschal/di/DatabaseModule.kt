package com.parthadae.seneschal.di

import android.content.Context
import androidx.room.Room
import com.parthadae.seneschal.data.local.ActivityDao
import com.parthadae.seneschal.data.local.CategoryDao
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
            .fallbackToDestructiveMigration()
            .build()

    @Provides fun categoryDao(db: SeneschalDatabase): CategoryDao = db.categoryDao()
    @Provides fun activityDao(db: SeneschalDatabase): ActivityDao = db.activityDao()
    @Provides fun timeSlotDao(db: SeneschalDatabase): TimeSlotDao = db.timeSlotDao()
    @Provides fun runningTimerDao(db: SeneschalDatabase): RunningTimerDao = db.runningTimerDao()
    @Provides fun pendingMutationDao(db: SeneschalDatabase): PendingMutationDao =
        db.pendingMutationDao()
}

package com.parthadae.seneschal.data.repository

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.appSettingsDataStore by preferencesDataStore(name = "app_settings")

/**
 * Local-only (not synced) UI preferences, stored in DataStore like
 * [com.parthadae.seneschal.voice.VoiceSettingsRepository].
 */
@Singleton
class AppSettingsRepository @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val showArchivedActivitiesKey = booleanPreferencesKey("show_archived_activities")

    /**
     * Whether archived activities appear as choosable options in the
     * activity picker and in the Manage Activities list. Historical views
     * (Today, Stats, voice summaries) always render archived activities
     * regardless of this flag.
     */
    val showArchivedActivities: Flow<Boolean> =
        context.appSettingsDataStore.data.map { prefs ->
            prefs[showArchivedActivitiesKey] ?: false
        }

    suspend fun setShowArchivedActivities(enabled: Boolean) {
        context.appSettingsDataStore.edit { prefs ->
            prefs[showArchivedActivitiesKey] = enabled
        }
    }
}

package com.parthadae.seneschal.voice

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.voiceSettingsDataStore by preferencesDataStore(name = "voice_settings")

@Singleton
class VoiceSettingsRepository @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val listenOnLaunchKey = booleanPreferencesKey("listen_on_launch")

    /**
     * Whether opening the app from outside (launcher icon, side-key remap,
     * "Hey Google, open Seneschal") should immediately start a voice session.
     */
    val listenOnLaunch: Flow<Boolean> =
        context.voiceSettingsDataStore.data.map { prefs ->
            prefs[listenOnLaunchKey] ?: true
        }

    suspend fun setListenOnLaunch(enabled: Boolean) {
        context.voiceSettingsDataStore.edit { prefs ->
            prefs[listenOnLaunchKey] = enabled
        }
    }
}

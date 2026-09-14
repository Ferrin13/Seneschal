package com.parthadae.seneschal.push

import android.content.Context
import android.os.Build
import android.util.Log
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.google.firebase.messaging.FirebaseMessaging
import com.parthadae.seneschal.auth.AuthRepository
import com.parthadae.seneschal.data.remote.SeneschalApi
import com.parthadae.seneschal.data.remote.dto.PushDeviceRegisterRequest
import com.parthadae.seneschal.data.remote.dto.PushDeviceUnregisterRequest
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

private val Context.pushDataStore by preferencesDataStore(name = "push_registration")

/**
 * Keeps the backend's `push_devices` row for this install in sync with the
 * current FCM registration token and signed-in account.
 *
 * Registration is idempotent and cheap (an upsert), so [ensureRegistered] is
 * simply called from every [com.parthadae.seneschal.sync.SyncWorker] run. It
 * short-circuits when the same token was uploaded for the same account
 * recently, so the network call happens on first sign-in, after a token
 * rotation ([onTokenRefreshed]) and then roughly daily as a heartbeat that
 * bumps `last_seen_at` server-side.
 */
@Singleton
class PushTokenRegistrar @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: SeneschalApi,
    private val authRepository: AuthRepository,
) {
    private val tokenKey = stringPreferencesKey("registered_token")
    private val uidKey = stringPreferencesKey("registered_uid")
    private val atKey = longPreferencesKey("registered_at_ms")

    /**
     * Upload the current FCM token for the signed-in user if it hasn't been
     * uploaded (for this account) within [REFRESH_INTERVAL_MS]. No-op when
     * signed out. Throws on network failure so callers can log it; the next
     * sync retries.
     */
    suspend fun ensureRegistered(force: Boolean = false) {
        val uid = authRepository.currentUid() ?: return
        val token = FirebaseMessaging.getInstance().token.await()
        val prefs = context.pushDataStore.data.first()
        val fresh = prefs[tokenKey] == token &&
            prefs[uidKey] == uid &&
            System.currentTimeMillis() - (prefs[atKey] ?: 0L) < REFRESH_INTERVAL_MS
        if (fresh && !force) return

        api.registerPushDevice(
            PushDeviceRegisterRequest(
                token = token,
                platform = "android",
                deviceName = deviceName(),
            )
        )
        context.pushDataStore.edit {
            it[tokenKey] = token
            it[uidKey] = uid
            it[atKey] = System.currentTimeMillis()
        }
        Log.i(TAG, "registered push token for $uid")
    }

    /**
     * FCM rotated the token. Forget what we uploaded so the next sync (or an
     * immediate one kicked by the caller) re-registers.
     */
    suspend fun onTokenRefreshed() {
        context.pushDataStore.edit { it.clear() }
    }

    /**
     * Best-effort removal of this install's token from the account, to be
     * called *before* Firebase sign-out (the request needs a valid ID token).
     * Local state is cleared regardless so a later sign-in re-registers.
     */
    suspend fun unregister() {
        val prefs = context.pushDataStore.data.first()
        val token = prefs[tokenKey]
            ?: runCatching { FirebaseMessaging.getInstance().token.await() }.getOrNull()
        if (token != null && authRepository.currentUid() != null) {
            runCatching { api.unregisterPushDevice(PushDeviceUnregisterRequest(token)) }
                .onFailure { Log.w(TAG, "unregister failed", it) }
        }
        context.pushDataStore.edit { it.clear() }
    }

    private fun deviceName(): String {
        val manufacturer = Build.MANUFACTURER.orEmpty().trim()
        val model = Build.MODEL.orEmpty().trim()
        val name = if (model.startsWith(manufacturer, ignoreCase = true)) model
        else "$manufacturer $model".trim()
        return name.ifBlank { "Android device" }
            .replaceFirstChar { it.uppercase() }
            .take(120)
    }

    companion object {
        private const val TAG = "PushTokenRegistrar"
        private const val REFRESH_INTERVAL_MS = 24L * 60 * 60 * 1000
    }
}

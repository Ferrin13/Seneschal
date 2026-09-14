package com.parthadae.seneschal.push

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.parthadae.seneschal.sync.SyncScheduler
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.runBlocking
import javax.inject.Inject

/**
 * FCM entry point. Two jobs:
 *
 *  - [onNewToken]: forget the previously uploaded token and kick a sync so
 *    [PushTokenRegistrar] re-registers the new one with the backend.
 *  - [onMessageReceived]: render backend-sent data messages. Because the
 *    backend never sets an FCM `notification` block, this fires whether the
 *    app is foregrounded or backgrounded, and we control the tap action.
 */
@AndroidEntryPoint
class SeneschalMessagingService : FirebaseMessagingService() {
    @Inject lateinit var registrar: PushTokenRegistrar
    @Inject lateinit var notifier: DealAlertNotifier
    @Inject lateinit var syncScheduler: SyncScheduler

    override fun onNewToken(token: String) {
        // Runs on a background thread; DataStore edit is quick.
        runBlocking { registrar.onTokenRefreshed() }
        syncScheduler.requestImmediateSync()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        when (data["type"]) {
            "marketplace_notification" -> notifier.show(data)
            else -> Log.i(TAG, "ignoring push with type=${data["type"]}")
        }
    }

    companion object {
        private const val TAG = "SeneschalMessaging"
    }
}

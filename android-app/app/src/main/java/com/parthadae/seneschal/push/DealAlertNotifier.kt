package com.parthadae.seneschal.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.net.toUri
import com.parthadae.seneschal.MainActivity
import com.parthadae.seneschal.R
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Renders a deal-hunter push message as an OS notification.
 *
 * The backend sends data-only FCM messages (see `backend/src/push/payload.ts`)
 * so the phone owns presentation: the tap target is the web-app URL carried
 * in the payload, opened in the default browser, rather than this app.
 */
@Singleton
class DealAlertNotifier @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    /** Whether the OS will actually display our notifications right now. */
    fun notificationsEnabled(): Boolean =
        NotificationManagerCompat.from(context).areNotificationsEnabled()

    fun show(data: Map<String, String>) {
        ensureChannel()
        if (!notificationsEnabled()) {
            Log.i(TAG, "notifications disabled; dropping ${data["notificationId"]}")
            return
        }

        val title = data["title"]?.takeIf { it.isNotBlank() }
            ?: if (data["kind"] == "needs_login") "Facebook login needed" else "New deal"
        val body = data["body"].orEmpty()
        val url = data["url"]
        val id = data["notificationId"] ?: url ?: title
        val requestCode = id.hashCode()

        val contentIntent = if (!url.isNullOrBlank()) {
            Intent(Intent.ACTION_VIEW, url.toUri()).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        } else {
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
        }
        val pending = PendingIntent.getActivity(
            context,
            requestCode,
            contentIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .setGroup(GROUP_KEY)
            .build()

        try {
            NotificationManagerCompat.from(context).notify(requestCode, notification)
        } catch (e: SecurityException) {
            // POST_NOTIFICATIONS revoked between the check and the call.
            Log.w(TAG, "notify failed", e)
        }
    }

    private fun ensureChannel() {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "Deal alerts",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Marketplace deals from Deal Hunter that clear your thresholds"
                }
            )
        }
    }

    companion object {
        private const val TAG = "DealAlertNotifier"
        const val CHANNEL_ID = "seneschal-deals"
        private const val GROUP_KEY = "seneschal-deals"
    }
}

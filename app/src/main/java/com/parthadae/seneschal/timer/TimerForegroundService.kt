package com.parthadae.seneschal.timer

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.parthadae.seneschal.MainActivity
import com.parthadae.seneschal.R
import com.parthadae.seneschal.data.repository.ActivityRepository
import com.parthadae.seneschal.data.repository.TimerRepository
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Foreground service that surfaces the running timer in a sticky
 * notification (with elapsed-time updates) and keeps the process alive
 * while a timer is active. Stops itself when the timer clears.
 */
@AndroidEntryPoint
class TimerForegroundService : Service() {
    @Inject lateinit var timerRepository: TimerRepository
    @Inject lateinit var activityRepository: ActivityRepository

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var tickJob: Job? = null
    private var lastActivityName: String? = null
    private var lastStartedAtMs: Long = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
        startForeground(NOTIF_ID, buildNotification("Starting…", null))

        scope.launch {
            timerRepository.timer.collectLatest { timer ->
                if (timer == null) {
                    stopSelf()
                    return@collectLatest
                }
                lastStartedAtMs = timer.startedAtMs
                lastActivityName = activityRepository.activityById(timer.primaryActivityId)?.name
                refreshNotification()
                tickJob?.cancel()
                tickJob = scope.launch {
                    while (true) {
                        kotlinx.coroutines.delay(15_000)
                        refreshNotification()
                    }
                }
            }
        }
    }

    private fun refreshNotification() {
        val elapsed = (System.currentTimeMillis() - lastStartedAtMs).coerceAtLeast(0L)
        val name = lastActivityName ?: "Timer"
        val notification = buildNotification(name, formatHm(elapsed))
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_ID, notification)
    }

    private fun buildNotification(title: String, subtitle: String?): android.app.Notification {
        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(subtitle ?: "")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setContentIntent(pi)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(
                        CHANNEL_ID,
                        "Active timer",
                        NotificationManager.IMPORTANCE_LOW,
                    )
                )
            }
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        const val CHANNEL_ID = "seneschal-timer"
        const val NOTIF_ID = 0xCAFE

        fun start(context: Context) {
            val intent = Intent(context, TimerForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, TimerForegroundService::class.java))
        }
    }
}

private fun formatHm(ms: Long): String {
    val totalMin = (ms / 60_000L)
    val h = totalMin / 60
    val m = totalMin % 60
    return when {
        h > 0 -> "${h}h ${m}m elapsed"
        else -> "${m}m elapsed"
    }
}

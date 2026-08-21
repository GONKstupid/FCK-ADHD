package com.gonkstupid.fckadhd

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/**
 * Foreground service that keeps the alarm alive during the REMINDING state.
 * Acquires a PARTIAL_WAKE_LOCK and displays an ongoing notification.
 */
class AlarmForegroundService : Service() {

    companion object {
        private const val CHANNEL_ID = "alarm_channel"
        private const val NOTIFICATION_ID = 9001
        private const val WAKE_LOCK_TAG = "fckadhd:AlarmWakeLock"

        fun start(context: Context, label: String) {
            val intent = Intent(context, AlarmForegroundService::class.java).apply {
                putExtra("label", label)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, AlarmForegroundService::class.java))
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val label = intent?.getStringExtra("label") ?: "FCK-ADHD Alarm"

        acquireWakeLock()
        startForeground(NOTIFICATION_ID, buildNotification(label))

        return START_NOT_STICKY
    }

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
    }

    // ── Notification ──────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "FCK-ADHD Alarme",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Alarm-Benachrichtigungen für FCK-ADHD Routinen"
                enableVibration(true)
                setBypassDnd(true)
            }

            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(label: String): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("FCK-ADHD Alarm")
            .setContentText(label)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(pendingIntent)
            .build()
    }

    // ── Wake lock ─────────────────────────────────────────────────────────────

    private fun acquireWakeLock() {
        if (wakeLock != null) return

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            WAKE_LOCK_TAG,
        ).apply {
            acquire(10 * 60 * 1000L) // 10 minute timeout safety
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        wakeLock = null
    }
}

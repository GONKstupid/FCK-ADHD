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
        // Intent straight to the alarm screen so tapping (or the system's
        // full-screen launch) lands on AlarmActivity, not the web view.
        val alarmIntent = Intent(this, AlarmActivity::class.java).apply {
            putExtra("label", label)
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            alarmIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("FCK-ADHD Alarm")
            .setContentText(label)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(pendingIntent)
            // Full-screen intent: lets the system launch AlarmActivity directly
            // when the device is locked or the USE_FULL_SCREEN_INTENT quota
            // applies (requires android.permission.USE_FULL_SCREEN_INTENT).
            .setFullScreenIntent(pendingIntent, true)
            .build()
    }

    // ── Wake lock ─────────────────────────────────────────────────────────────

    private fun acquireWakeLock() {
        // Only skip when the lock is still actually held. The 10-minute timeout
        // auto-releases it, so on the endless repeat chain the lock must be
        // (re)created/acquired again — otherwise audio stalls after expiry.
        if (wakeLock?.isHeld == true) return

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

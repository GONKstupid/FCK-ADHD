package com.gonkstupid.fckadhd

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build

/**
 * Handles AlarmManager scheduling with setAlarmClock() for highest priority.
 * Falls back to setExactAndAllowWhileIdle() for API < 31.
 * Persists deadlines in SharedPreferences for boot recovery.
 */
class AlarmScheduler(private val context: Context) {

    companion object {
        private const val PREFS_NAME = "fckadhd_alarms"
        private const val ACTION_ALARM_FIRED = "com.gonkstupid.fckadhd.ALARM_FIRED"
    }

    private val alarmManager: AlarmManager =
        context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    // ── Schedule ──────────────────────────────────────────────────────────────

    fun scheduleExact(instanceId: String, deadlineMs: Long) {
        val pendingIntent = createPendingIntent(instanceId)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (alarmManager.canScheduleExactAlarms()) {
                val alarmInfo = AlarmManager.AlarmClockInfo(deadlineMs, pendingIntent)
                alarmManager.setAlarmClock(alarmInfo, pendingIntent)
            }
        } else {
            alarmManager.setExactAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                deadlineMs,
                pendingIntent,
            )
        }
    }

    fun cancel(instanceId: String) {
        val pendingIntent = createPendingIntent(instanceId)
        alarmManager.cancel(pendingIntent)
        pendingIntent.cancel()
    }

    fun isScheduled(instanceId: String): Boolean {
        val pendingIntent = createPendingIntent(instanceId)
        // PendingIntent.FLAG_NO_CREATE returns null if the PendingIntent doesn't exist
        val existing = PendingIntent.getBroadcast(
            context,
            instanceId.hashCode(),
            Intent(context, AlarmReceiver::class.java).apply {
                action = ACTION_ALARM_FIRED
                putExtra("instanceId", instanceId)
            },
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
        )
        return existing != null
    }

    // ── Persistence (for boot recovery) ───────────────────────────────────────

    fun persistDeadline(instanceId: String, deadlineMs: Long) {
        prefs.edit().putLong("deadline_$instanceId", deadlineMs).apply()
    }

    fun removeDeadline(instanceId: String) {
        prefs.edit().remove("deadline_$instanceId").apply()
    }

    fun getPersistedDeadlines(): Map<String, Long> {
        val result = mutableMapOf<String, Long>()
        for (key in prefs.all.keys) {
            if (key.startsWith("deadline_")) {
                val instanceId = key.removePrefix("deadline_")
                val deadline = prefs.getLong(key, -1L)
                if (deadline > 0) {
                    result[instanceId] = deadline
                }
            }
        }
        return result
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun createPendingIntent(instanceId: String): PendingIntent {
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            action = ACTION_ALARM_FIRED
            putExtra("instanceId", instanceId)
        }

        return PendingIntent.getBroadcast(
            context,
            instanceId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}

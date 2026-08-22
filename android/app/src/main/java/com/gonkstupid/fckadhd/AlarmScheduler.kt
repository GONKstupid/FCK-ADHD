package com.gonkstupid.fckadhd

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.util.Log

/**
 * Handles AlarmManager scheduling with setAlarmClock() for highest priority.
 * Falls back to setExactAndAllowWhileIdle() for API < 31.
 * Persists deadlines + labels + repeat counts in SharedPreferences so the
 * endless repeat chain and boot recovery carry full metadata.
 */
class AlarmScheduler(private val context: Context) {

    companion object {
        private const val TAG = "AlarmScheduler"
        private const val PREFS_NAME = "fckadhd_alarms"
        private const val ACTION_ALARM_FIRED = "com.gonkstupid.fckadhd.ALARM_FIRED"

        /** Interval of the endless repeat chain: 1 minute. */
        const val REPEAT_INTERVAL_MS = 60_000L

        /** SharedPreferences key holding the escalation ringtone URI (used from repeat #3). */
        const val KEY_ESCALATION_RINGTONE = "escalation_ringtone_uri"

        /** Status flag: last exact-alarm scheduling attempt had the required permission. */
        private const val KEY_EXACT_ALARM_GRANTED = "exact_alarm_granted"
    }

    private val alarmManager: AlarmManager =
        context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    // ── Schedule ──────────────────────────────────────────────────────────────

    /**
     * Schedules an exact alarm for [instanceId] at [deadlineMs].
     * Never fails silently: on API 31+ without the exact-alarm permission it
     * logs an error and stores a status flag (see [wasExactAlarmGranted]).
     *
     * [repeatCount] is OPTIONAL: if provided it is persisted; if absent the
     * already persisted repeat count is kept (never reset), defaulting to 0
     * only for brand-new alarms without existing metadata. Scheduling also
     * clears the cancel-tombstone, re-arming the instance.
     */
    fun scheduleExact(
        instanceId: String,
        deadlineMs: Long,
        label: String? = null,
        repeatCount: Int? = null,
        ringtoneUri: String? = null,
    ) {
        val resolvedLabel = label ?: getLabel(instanceId) ?: "FCK-ADHD Alarm"
        val effectiveRepeatCount = repeatCount ?: getRepeatCount(instanceId)

        // Persist metadata so the repeat chain and boot recovery have full info.
        persistLabel(instanceId, resolvedLabel)
        setRepeatCount(instanceId, effectiveRepeatCount)

        // A fresh schedule re-arms the instance: clear any cancel tombstone.
        clearTombstone(instanceId)

        val pendingIntent = createPendingIntent(instanceId, resolvedLabel, effectiveRepeatCount, ringtoneUri)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (alarmManager.canScheduleExactAlarms()) {
                val alarmInfo = AlarmManager.AlarmClockInfo(deadlineMs, pendingIntent)
                alarmManager.setAlarmClock(alarmInfo, pendingIntent)
                prefs.edit().putBoolean(KEY_EXACT_ALARM_GRANTED, true).apply()
            } else {
                Log.e(
                    TAG,
                    "Cannot schedule exact alarm for '$instanceId': " +
                        "canScheduleExactAlarms() is false. The alarm WILL NOT fire reliably. " +
                        "Prompt the user via BlockerPlugin.openExactAlarmSettings().",
                )
                prefs.edit().putBoolean(KEY_EXACT_ALARM_GRANTED, false).apply()
            }
        } else {
            alarmManager.setExactAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                deadlineMs,
                pendingIntent,
            )
            prefs.edit().putBoolean(KEY_EXACT_ALARM_GRANTED, true).apply()
        }
    }

    /**
     * Schedules the next occurrence of the endless 1-minute repeat chain.
     * Only a single trigger needs to be scheduled: AlarmReceiver schedules the
     * next +60s occurrence itself every time the alarm fires.
     */
    fun scheduleRepeat(
        instanceId: String,
        triggerAtMs: Long,
        label: String,
        repeatCount: Int,
        ringtoneUri: String? = null,
    ) {
        scheduleExact(instanceId, triggerAtMs, label, repeatCount, ringtoneUri)
    }

    /**
     * Cancels the alarm AND removes all persisted metadata (deadline, label,
     * repeat count). Cancelling stops the entire repeat chain.
     *
     * Also writes a tombstone key: if a broadcast of this instance is already
     * in flight when cancel happens, AlarmReceiver sees the tombstone and
     * drops the event instead of resurrecting the chain.
     */
    fun cancel(instanceId: String) {
        val pendingIntent = createPendingIntent(instanceId, null, 0, null)
        alarmManager.cancel(pendingIntent)
        pendingIntent.cancel()
        removeAllMetadata(instanceId)
        prefs.edit().putBoolean(tombstoneKey(instanceId), true).apply()
    }

    /** True if this instance was cancelled and in-flight broadcasts must be dropped. */
    fun isCancelled(instanceId: String): Boolean =
        prefs.getBoolean(tombstoneKey(instanceId), false)

    private fun clearTombstone(instanceId: String) {
        prefs.edit().remove(tombstoneKey(instanceId)).apply()
    }

    private fun tombstoneKey(instanceId: String) = "cancelled_$instanceId"

    fun isScheduled(instanceId: String): Boolean {
        // PendingIntent matching ignores extras, so plain extras are fine here.
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

    /** True if the last exact-alarm scheduling attempt had the required permission. */
    fun wasExactAlarmGranted(): Boolean = prefs.getBoolean(KEY_EXACT_ALARM_GRANTED, true)

    // ── Persistence (for boot recovery + repeat chain) ────────────────────────

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

    fun persistLabel(instanceId: String, label: String) {
        prefs.edit().putString("label_$instanceId", label).apply()
    }

    fun getLabel(instanceId: String): String? =
        prefs.getString("label_$instanceId", null)

    fun setRepeatCount(instanceId: String, repeatCount: Int) {
        prefs.edit().putInt("repeat_$instanceId", repeatCount).apply()
    }

    fun getRepeatCount(instanceId: String): Int =
        prefs.getInt("repeat_$instanceId", 0)

    /**
     * Persists the silent flag for this instance. Silent alarms show the
     * overlay without ringtone until the escalation threshold is reached.
     */
    fun persistSilent(instanceId: String, silent: Boolean) {
        prefs.edit().putBoolean("silent_$instanceId", silent).apply()
    }

    fun getSilent(instanceId: String): Boolean =
        prefs.getBoolean("silent_$instanceId", false)

    fun setEscalationRingtoneUri(uri: String?) {
        val editor = prefs.edit()
        if (uri == null) {
            editor.remove(KEY_ESCALATION_RINGTONE)
        } else {
            editor.putString(KEY_ESCALATION_RINGTONE, uri)
        }
        editor.apply()
    }

    fun getEscalationRingtoneUri(): String? =
        prefs.getString(KEY_ESCALATION_RINGTONE, null)

    private fun removeAllMetadata(instanceId: String) {
        prefs.edit()
            .remove("deadline_$instanceId")
            .remove("label_$instanceId")
            .remove("repeat_$instanceId")
            .remove("silent_$instanceId")
            .apply()
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Builds the broadcast PendingIntent carrying the full alarm metadata
     * (instanceId, label, repeatCount, optional ringtoneUri).
     * FLAG_UPDATE_CURRENT keeps extras fresh when the chain re-schedules.
     */
    private fun createPendingIntent(
        instanceId: String,
        label: String?,
        repeatCount: Int,
        ringtoneUri: String?,
    ): PendingIntent {
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            action = ACTION_ALARM_FIRED
            putExtra("instanceId", instanceId)
            label?.let { putExtra("label", it) }
            putExtra("repeatCount", repeatCount)
            ringtoneUri?.let { putExtra("ringtoneUri", it) }
        }

        return PendingIntent.getBroadcast(
            context,
            instanceId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}

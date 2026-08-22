package com.gonkstupid.fckadhd

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.gonkstupid.fckadhd.plugins.BlockerPlugin

/**
 * Receives alarm intents from AlarmManager, IMMEDIATELY schedules the next
 * occurrence of the endless 1-minute repeat chain, then launches the
 * ForegroundService + AlarmActivity to display the alarm.
 *
 * Repeat state is persisted in SharedPreferences (not kept only in the
 * PendingIntent), so the chain is self-sustaining and survives process
 * death, Doze and reboot (see BootReceiver).
 */
class AlarmReceiver : BroadcastReceiver() {

    companion object {
        /** From this repeat count on, the escalation ringtone is used. */
        private const val ESCALATION_THRESHOLD = 3
    }

    override fun onReceive(context: Context, intent: Intent) {
        val instanceId = intent.getStringExtra("instanceId") ?: return
        val scheduler = AlarmScheduler(context)

        // Tombstone guard: if web cancelled this instance while the broadcast
        // was already in flight, drop it — do NOT resurrect the chain.
        if (scheduler.isCancelled(instanceId)) return

        val label = intent.getStringExtra("label")
            ?: scheduler.getLabel(instanceId)
            ?: "FCK-ADHD Alarm"

        // 1. The persisted repeat count is THIS delivery's count (first fire = 0).
        //    count + 1 is stored only for the NEXT chain link.
        val repeatCount = scheduler.getRepeatCount(instanceId)

        // 2. IMMEDIATELY schedule the next link of the endless repeat chain
        //    (now + 60s) carrying the NEXT repeat count. Doing this first
        //    guarantees the chain never breaks, even if anything below throws.
        scheduler.scheduleRepeat(
            instanceId = instanceId,
            triggerAtMs = System.currentTimeMillis() + AlarmScheduler.REPEAT_INTERVAL_MS,
            label = label,
            repeatCount = repeatCount + 1,
        )

        // 3. Escalation: from repeatCount >= 3 (the 4th fire) on, use the
        //    configured escalation ringtone — "3 repeats before escalation".
        var ringtoneUri = intent.getStringExtra("ringtoneUri")
        if (repeatCount >= ESCALATION_THRESHOLD) {
            scheduler.getEscalationRingtoneUri()?.let { ringtoneUri = it }
        }

        // 4. Start the foreground service first (keeps process alive).
        AlarmForegroundService.start(context, label)

        // Launch the full-screen alarm activity.
        val alarmIntent = Intent(context, AlarmActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra("label", label)
            putExtra("repeatCount", repeatCount)
            putExtra("instanceId", instanceId)
            ringtoneUri?.let { putExtra("ringtoneUri", it) }
        }
        context.startActivity(alarmIntent)

        // 5. Notify the web layer (alarmFired event, see BlockerPlugin).
        BlockerPlugin.emitAlarmFired(instanceId, repeatCount)
    }
}

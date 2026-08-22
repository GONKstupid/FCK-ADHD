package com.gonkstupid.fckadhd

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.gonkstupid.fckadhd.plugins.BlockerPlugin

/**
 * Receives BOOT_COMPLETED and restores all persisted alarm deadlines.
 * Ensures alarms survive device reboots.
 *
 * - Future deadlines: re-scheduled exactly as before.
 * - Overdue deadlines: NOT deleted — the alarm fires immediately (FGS +
 *   AlarmActivity with the stored label) and the endless repeat chain is
 *   started by scheduling the next occurrence at now + 60s.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        val scheduler = AlarmScheduler(context)
        val now = System.currentTimeMillis()

        for ((instanceId, deadlineMs) in scheduler.getPersistedDeadlines()) {
            val label = scheduler.getLabel(instanceId) ?: "FCK-ADHD Alarm"

            if (deadlineMs > now) {
                // Future deadline: re-schedule as usual.
                scheduler.scheduleExact(instanceId, deadlineMs, label)
            } else {
                // Overdue deadline: fire immediately and begin the repeat chain.
                // The stored count is THIS delivery's repeatCount (first fire = 0);
                // count + 1 is persisted for the NEXT chain link only.
                val repeatCount = scheduler.getRepeatCount(instanceId)

                // Keep the deadline persisted so the chain keeps its metadata;
                // the chain itself continues via the next scheduled trigger.
                scheduler.scheduleRepeat(
                    instanceId = instanceId,
                    triggerAtMs = now + AlarmScheduler.REPEAT_INTERVAL_MS,
                    label = label,
                    repeatCount = repeatCount + 1,
                )

                AlarmForegroundService.start(context, label)

                val alarmIntent = Intent(context, AlarmActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    putExtra("label", label)
                    putExtra("repeatCount", repeatCount)
                    putExtra("instanceId", instanceId)
                }
                context.startActivity(alarmIntent)

                BlockerPlugin.emitAlarmFired(instanceId, repeatCount)
            }
        }
    }
}

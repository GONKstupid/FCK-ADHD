package com.gonkstupid.fckadhd

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Receives BOOT_COMPLETED and re-schedules all persisted alarm deadlines.
 * Ensures alarms survive device reboots.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        val scheduler = AlarmScheduler(context)
        val deadlines = scheduler.getPersistedDeadlines()

        for ((instanceId, deadlineMs) in deadlines) {
            // Only re-schedule alarms that haven't already passed
            if (deadlineMs > System.currentTimeMillis()) {
                scheduler.scheduleExact(instanceId, deadlineMs)
            } else {
                // Clean up expired deadlines
                scheduler.removeDeadline(instanceId)
            }
        }
    }
}

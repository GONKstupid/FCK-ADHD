package com.gonkstupid.fckadhd

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Receives alarm intents from AlarmManager and launches the
 * ForegroundService + AlarmActivity to display the alarm.
 */
class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val instanceId = intent.getStringExtra("instanceId") ?: return

        // Start the foreground service first (keeps process alive)
        AlarmForegroundService.start(context, "FCK-ADHD Alarm")

        // Launch the full-screen alarm activity
        val alarmIntent = Intent(context, AlarmActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra("label", "FCK-ADHD Alarm")
            putExtra("repeatCount", 0)
            putExtra("instanceId", instanceId)
        }
        context.startActivity(alarmIntent)
    }
}

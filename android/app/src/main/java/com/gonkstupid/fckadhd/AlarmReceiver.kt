package com.gonkstupid.fckadhd

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Receives alarm intents from AlarmManager and launches the
 * ForegroundService + AlarmActivity to display the alarm.
 * Passes through label, repeatCount, ringtoneUri, and instanceId.
 */
class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val instanceId = intent.getStringExtra("instanceId") ?: return
        val label = intent.getStringExtra("label") ?: "FCK-ADHD Alarm"
        val repeatCount = intent.getIntExtra("repeatCount", 0)
        val ringtoneUri = intent.getStringExtra("ringtoneUri")

        // Start the foreground service first (keeps process alive)
        AlarmForegroundService.start(context, label)

        // Launch the full-screen alarm activity
        val alarmIntent = Intent(context, AlarmActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra("label", label)
            putExtra("repeatCount", repeatCount)
            putExtra("instanceId", instanceId)
            ringtoneUri?.let { putExtra("ringtoneUri", it) }
        }
        context.startActivity(alarmIntent)
    }
}

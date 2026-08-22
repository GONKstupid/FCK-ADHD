package com.gonkstupid.fckadhd

import android.app.Activity
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import android.widget.TextView

/**
 * Full-screen alarm activity that shows over the lock screen.
 * Displays the routine label and repeat count with a dark background.
 * Triggers ringtone and vibration via AlarmRingtoneManager.
 */
class AlarmActivity : Activity() {

    companion object {
        var instance: AlarmActivity? = null
    }

    private var ringtoneManager: AlarmRingtoneManager? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Show over lock screen and turn screen on
        setShowWhenLocked(true)
        setTurnScreenOn(true)

        // Keep screen on while alarm is visible
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        setContentView(R.layout.activity_alarm)

        instance = this

        val label = intent.getStringExtra("label") ?: "Alarm"
        val repeatCount = intent.getIntExtra("repeatCount", 0)

        findViewById<TextView>(R.id.alarm_label).text = label
        findViewById<TextView>(R.id.alarm_repeat).text =
            if (repeatCount > 0) "Wiederholung #$repeatCount" else "Erster Alarm"

        // Start the foreground service to keep the alarm alive
        AlarmForegroundService.start(this, label)

        // Start ringtone + vibration
        ringtoneManager = AlarmRingtoneManager(this)
        val ringtoneUriString = intent.getStringExtra("ringtoneUri")
        val ringtoneUri = ringtoneUriString?.let { Uri.parse(it) }
        ringtoneManager?.start(ringtoneUri)
    }

    override fun onDestroy() {
        ringtoneManager?.stop()
        ringtoneManager = null
        super.onDestroy()
        if (instance === this) {
            instance = null
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // Prevent dismissing the alarm via back button
    }
}

package com.gonkstupid.fckadhd

import android.app.Activity
import android.content.Intent
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

        applyIntentExtras(intent)

        // Start the foreground service to keep the alarm alive
        AlarmForegroundService.start(this, intent.getStringExtra("label") ?: "Alarm")

        // Start ringtone + vibration.
        // If a ringtoneUri extra is present it is the escalation ringtone and
        // is played ADDITIVELY to the default alarm sound (second MediaPlayer
        // inside AlarmRingtoneManager, released in onDestroy via stop()).
        ringtoneManager = AlarmRingtoneManager(this)
        val ringtoneUriString = intent.getStringExtra("ringtoneUri")
        val escalationUri = ringtoneUriString?.let { Uri.parse(it) }
        ringtoneManager?.start(ringtoneUri = null, escalationUri = escalationUri)
    }

    /**
     * The activity is singleInstance, so repeat alarm intents (every 60s,
     * with updated repeatCount and from repeat ≥3 a ringtoneUri extra) are
     * delivered HERE instead of onCreate() while the screen is alive.
     * Update the displayed label/repeat counter and start the additive
     * escalation playback once the escalation ringtone URI arrives.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        applyIntentExtras(intent)

        intent.getStringExtra("ringtoneUri")?.let { uriString ->
            // Guarded inside startEscalation(): no double-start if the same
            // escalation URI is already playing.
            ringtoneManager?.startEscalation(Uri.parse(uriString))
        }
    }

    /** Updates the label + repeat counter views from the given intent's extras. */
    private fun applyIntentExtras(intent: Intent) {
        val label = intent.getStringExtra("label") ?: "Alarm"
        val repeatCount = intent.getIntExtra("repeatCount", 0)

        findViewById<TextView>(R.id.alarm_label).text = label
        findViewById<TextView>(R.id.alarm_repeat).text =
            if (repeatCount > 0) "Wiederholung #$repeatCount" else "Erster Alarm"
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

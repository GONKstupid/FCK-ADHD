package com.gonkstupid.fckadhd

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import com.gonkstupid.fckadhd.plugins.BlockerPlugin

/**
 * Full-screen alarm activity that shows over the lock screen.
 * Displays the routine label and repeat count with a dark background.
 * Triggers ringtone and vibration via AlarmRingtoneManager — unless the
 * alarm runs in silent mode (overlay only, no sound; from repeat #3 on
 * the escalation threshold forces a FULL alarm).
 */
class AlarmActivity : Activity() {

    companion object {
        var instance: AlarmActivity? = null

        /** Hold duration for the "ERLEDIGT – HALTEN" confirm button. */
        private const val HOLD_CONFIRM_MS = 2000L
        private const val HOLD_PROGRESS_TICK_MS = 50L

        /** From this repeat count on, silent mode is overridden by the full alarm. */
        private const val ESCALATION_THRESHOLD = 3
    }

    private var ringtoneManager: AlarmRingtoneManager? = null
    private var instanceId: String? = null
    private var basePlaying = false
    private var confirmed = false
    private val holdHandler = Handler(Looper.getMainLooper())
    private var holdProgressRunnable: Runnable? = null

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

        val instanceId = intent.getStringExtra("instanceId")
        val silent = resolveSilent(intent)

        // Start the foreground service to keep the alarm alive
        AlarmForegroundService.start(
            this,
            intent.getStringExtra("label") ?: "Alarm",
            instanceId,
            silent,
            intent.getIntExtra("repeatCount", 0),
        )

        // Start ringtone + vibration — skipped entirely in silent mode
        // (overlay + FGS + KEEP_SCREEN_ON stay active).
        // If a ringtoneUri extra is present it is the escalation ringtone and
        // is played ADDITIVELY to the default alarm sound (second MediaPlayer
        // inside AlarmRingtoneManager, released in onDestroy via stop()).
        ringtoneManager = AlarmRingtoneManager(this)
        if (!silent) {
            val ringtoneUriString = intent.getStringExtra("ringtoneUri")
            val escalationUri = ringtoneUriString?.let { Uri.parse(it) }
            ringtoneManager?.start(ringtoneUri = null, escalationUri = escalationUri)
            basePlaying = true
        }

        setupHoldConfirmButton()
    }

    /**
     * Resolves whether this alarm delivery runs in silent mode.
     * Prefers the intent extra (set by AlarmReceiver, already capped at the
     * escalation threshold); when absent (e.g. launched via the FGS
     * notification) falls back to the persisted flag — but only below the
     * escalation threshold, from repeat #3 on it is always a FULL alarm.
     */
    private fun resolveSilent(intent: Intent): Boolean {
        val repeatCount = intent.getIntExtra("repeatCount", 0)
        return if (intent.hasExtra("silent")) {
            intent.getBooleanExtra("silent", false)
        } else {
            val id = intent.getStringExtra("instanceId") ?: return false
            if (repeatCount < ESCALATION_THRESHOLD) {
                AlarmScheduler(this).getSilent(id)
            } else {
                false
            }
        }
    }

    /**
     * Hold-to-confirm button: holding ~2 seconds confirms the alarm —
     * stops the ringtone, stops the foreground service, emits
     * `alarmConfirmed` to the web layer and finishes the activity.
     * The AlarmManager repeat chain is deliberately NOT cancelled: the next
     * repeat link must survive if the web layer fails to process the event.
     */
    private fun setupHoldConfirmButton() {
        val button = findViewById<TextView>(R.id.btn_confirm_hold)
        val startText = button.text

        val confirmRunnable = Runnable {
            button.text = "BESTÄTIGT"
            confirmAlarm()
        }

        button.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    button.alpha = 0.7f
                    val startTime = System.currentTimeMillis()
                    val progressRunnable = object : Runnable {
                        override fun run() {
                            val elapsed = System.currentTimeMillis() - startTime
                            button.text =
                                "ERLEDIGT – HALTEN… ${elapsed / 1000 + 1}/${HOLD_CONFIRM_MS / 1000}"
                            holdHandler.postDelayed(this, HOLD_PROGRESS_TICK_MS)
                        }
                    }
                    holdProgressRunnable = progressRunnable
                    holdHandler.post(progressRunnable)
                    holdHandler.postDelayed(confirmRunnable, HOLD_CONFIRM_MS)
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    holdHandler.removeCallbacks(confirmRunnable)
                    holdProgressRunnable?.let { holdHandler.removeCallbacks(it) }
                    holdProgressRunnable = null
                    button.alpha = 1.0f
                    button.text = startText
                    true
                }
                else -> false
            }
        }
    }

    /** Stops everything, notifies the web layer and closes the overlay. */
    private fun confirmAlarm() {
        // One-shot guard: prevents a double alarmConfirmed emission during
        // the finish() teardown window (e.g. confirmRunnable firing again).
        if (confirmed) return
        confirmed = true
        if (ringtoneManager?.isCurrentlyPlaying() == true) {
            ringtoneManager?.stop()
        }
        AlarmForegroundService.stop(this)
        instanceId?.let { BlockerPlugin.emitAlarmConfirmed(it) }
        finish()
    }

    /**
     * The activity is singleInstance, so repeat alarm intents (every 60s,
     * with updated repeatCount and from repeat ≥3 a ringtoneUri extra) are
     * delivered HERE instead of onCreate() while the screen is alive.
     * Update the displayed label/repeat counter; once the escalation
     * threshold flips a silent delivery to a FULL alarm, start the base
     * ringtone here (onCreate skipped it); otherwise start the additive
     * escalation playback when an escalation ringtone URI arrives.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        applyIntentExtras(intent)

        val silent = resolveSilent(intent)
        val escalationUri = intent.getStringExtra("ringtoneUri")?.let { Uri.parse(it) }

        if (!silent && !basePlaying) {
            // Escalated silent delivery (repeat >= threshold): the base alarm
            // sound was skipped in onCreate — start the full alarm now, with
            // the escalation tone additively if configured.
            ringtoneManager?.start(ringtoneUri = null, escalationUri = escalationUri)
            basePlaying = true
        } else {
            // Silent → still silent (or base already playing): additive
            // escalation path. Guarded inside startEscalation(): no
            // double-start if the same escalation URI is already playing.
            escalationUri?.let { ringtoneManager?.startEscalation(it) }
        }
    }

    /** Updates the label + repeat counter views from the given intent's extras. */
    private fun applyIntentExtras(intent: Intent) {
        val label = intent.getStringExtra("label") ?: "Alarm"
        val repeatCount = intent.getIntExtra("repeatCount", 0)
        instanceId = intent.getStringExtra("instanceId") ?: instanceId

        findViewById<TextView>(R.id.alarm_label).text = label
        findViewById<TextView>(R.id.alarm_repeat).text =
            if (repeatCount > 0) "Wiederholung #$repeatCount" else "Erster Alarm"
    }

    override fun onDestroy() {
        holdHandler.removeCallbacksAndMessages(null)
        ringtoneManager?.stop()
        ringtoneManager = null
        basePlaying = false
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

package com.gonkstupid.fckadhd

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.util.Log

/**
 * Manages ringtone playback and vibration patterns for the alarm.
 * Uses STREAM_ALARM for maximum volume on alarm channel.
 * Plays ringtone in a loop until [stop] is called.
 */
class AlarmRingtoneManager(private val context: Context) {

    companion object {
        private const val TAG = "AlarmRingtoneManager"

        // Long-pause alarm pattern: wait 500ms, vibrate 1000ms, pause 1500ms, repeat
        private val VIBRATION_PATTERN = longArrayOf(500, 1000, 1500)

        // Legacy API < 26 vibration pattern (same as above)
        private const val VIBRATION_REPEAT_INDEX = 1
    }

    private var mediaPlayer: MediaPlayer? = null
    private var escalationPlayer: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var isPlaying = false
    private var currentEscalationUri: Uri? = null

    // ── Ringtone ──────────────────────────────────────────────────────────────

    /**
     * Starts playing the alarm ringtone and vibration pattern.
     * @param ringtoneUri Custom ringtone URI, or null to use the system default alarm.
     * @param escalationUri Optional escalation ringtone played ADDITIVELY on a
     *                      second MediaPlayer alongside the base alarm sound.
     */
    fun start(ringtoneUri: Uri? = null, escalationUri: Uri? = null) {
        if (isPlaying) return
        isPlaying = true

        startRingtone(ringtoneUri)
        escalationUri?.let {
            currentEscalationUri = it
            startEscalationRingtone(it)
        }
        startVibration()
    }

    /**
     * Stops all ringtone playback and vibration.
     */
    fun stop() {
        if (!isPlaying) return
        isPlaying = false

        stopRingtone()
        stopEscalationRingtone()
        stopVibration()
    }

    fun isCurrentlyPlaying(): Boolean = isPlaying

    /**
     * Starts the additive escalation ringtone on the second MediaPlayer.
     * Called from AlarmActivity.onNewIntent() when a repeat intent carries a
     * ringtoneUri extra while the alarm screen is already alive.
     * Guarded against double-start: if the same URI is already playing,
     * this is a no-op.
     */
    fun startEscalation(uri: Uri) {
        if (currentEscalationUri == uri && escalationPlayer != null) return
        stopEscalationRingtone()
        currentEscalationUri = uri
        startEscalationRingtone(uri)
    }

    // ── Private: Ringtone ─────────────────────────────────────────────────────

    private fun startRingtone(ringtoneUri: Uri?) {
        try {
            val resolvedUri = ringtoneUri ?: getDefaultAlarmUri()

            mediaPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(context, resolvedUri)
                isLooping = true
                prepare()
                start()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start ringtone, falling back to default", e)
            tryFallbackRingtone()
        }
    }

    private fun tryFallbackRingtone() {
        try {
            val fallbackUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            mediaPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(context, fallbackUri)
                isLooping = true
                prepare()
                start()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Fallback ringtone also failed", e)
        }
    }

    /**
     * Plays the escalation ringtone on a dedicated second MediaPlayer,
     * ADDITIVELY to the base alarm sound. Lifecycle is bound to this manager
     * (released in [stop], which AlarmActivity calls from onDestroy).
     */
    private fun startEscalationRingtone(uri: Uri) {
        try {
            escalationPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(context, uri)
                isLooping = true
                prepare()
                start()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start escalation ringtone", e)
            escalationPlayer?.release()
            escalationPlayer = null
        }
    }

    private fun stopRingtone() {
        mediaPlayer?.let {
            try {
                if (it.isPlaying) it.stop()
                it.release()
            } catch (e: Exception) {
                Log.w(TAG, "Error stopping MediaPlayer", e)
            }
        }
        mediaPlayer = null
    }

    private fun stopEscalationRingtone() {
        escalationPlayer?.let {
            try {
                if (it.isPlaying) it.stop()
                it.release()
            } catch (e: Exception) {
                Log.w(TAG, "Error stopping escalation MediaPlayer", e)
            }
        }
        escalationPlayer = null
        currentEscalationUri = null
    }

    private fun getDefaultAlarmUri(): Uri {
        return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: Settings.System.DEFAULT_ALARM_ALERT_URI
    }

    // ── Private: Vibration ────────────────────────────────────────────────────

    private fun startVibration() {
        vibrator = getVibrator()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val effect = VibrationEffect.createWaveform(VIBRATION_PATTERN, VIBRATION_REPEAT_INDEX)
            vibrator?.vibrate(effect)
        } else {
            @Suppress("DEPRECATION")
            vibrator?.vibrate(VIBRATION_PATTERN, VIBRATION_REPEAT_INDEX)
        }
    }

    private fun stopVibration() {
        vibrator?.cancel()
        vibrator = null
    }

    private fun getVibrator(): Vibrator? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vibratorManager =
                context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            vibratorManager?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    }
}

package com.gonkstupid.fckadhd

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build

/**
 * Manages audio focus on STREAM_ALARM.
 * Requests AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE for the duration of an alarm.
 *
 * Singleton: AlarmForegroundService and BlockerPlugin MUST share the same
 * instance, otherwise a releaseFocus() from a second instance is a no-op
 * and other apps' audio (e.g. YouTube) never resumes after the alarm.
 */
class AudioController private constructor(private val context: Context) {

    companion object {
        @Volatile
        private var instance: AudioController? = null

        /** Returns the single shared AudioController instance. */
        fun getInstance(context: Context): AudioController {
            return instance ?: synchronized(this) {
                instance ?: AudioController(context.applicationContext).also { instance = it }
            }
        }
    }

    private val audioManager: AudioManager =
        context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    private var focusRequest: AudioFocusRequest? = null

    /**
     * Read/modified from both the main thread (AlarmForegroundService) and
     * Capacitor executor threads — @Volatile for visibility, and both
     * accessors are @Synchronized so request/abandon pairs stay consistent.
     */
    @Volatile
    private var hasFocus = false

    @Synchronized
    fun requestFocus() {
        if (hasFocus) return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()

            focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                .setAudioAttributes(attrs)
                .setAcceptsDelayedFocusGain(false)
                .setOnAudioFocusChangeListener { /* no-op: we hold focus until release */ }
                .build()

            focusRequest?.let {
                audioManager.requestAudioFocus(it)
            }
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(
                null,
                AudioManager.STREAM_ALARM,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE,
            )
        }

        hasFocus = true
    }

    @Synchronized
    fun releaseFocus() {
        if (!hasFocus) return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let {
                audioManager.abandonAudioFocusRequest(it)
            }
            focusRequest = null
        } else {
            @Suppress("DEPRECATION")
            audioManager.abandonAudioFocus(null)
        }

        hasFocus = false
    }
}

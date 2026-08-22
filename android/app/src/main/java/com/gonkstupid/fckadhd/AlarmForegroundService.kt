package com.gonkstupid.fckadhd

import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import androidx.core.app.NotificationCompat
import com.gonkstupid.fckadhd.plugins.BlockerPlugin

/**
 * Foreground service that keeps the alarm alive during the REMINDING state.
 * Acquires a PARTIAL_WAKE_LOCK and displays an ongoing notification.
 *
 * Sole owner of the alarm audio: requests exclusive audio focus (so other
 * apps' playback — e.g. YouTube — pauses) and plays the ringtone via
 * AlarmRingtoneManager. When AlarmActivity cannot be launched (background
 * activity launch restrictions) and the screen is on + unlocked, it shows a
 * full-screen SYSTEM_ALERT_WINDOW overlay OVER other apps instead.
 */
class AlarmForegroundService : Service() {

    companion object {
        private const val TAG = "AlarmForegroundService"
        private const val CHANNEL_ID = "alarm_channel"
        private const val CHANNEL_ID_SILENT = "alarm_channel_silent"
        private const val NOTIFICATION_ID = 9001
        private const val WAKE_LOCK_TAG = "fckadhd:AlarmWakeLock"

        /** Hold duration for the overlay's "ERLEDIGT – HALTEN" button. */
        private const val HOLD_CONFIRM_MS = 2000L
        private const val HOLD_PROGRESS_TICK_MS = 50L

        /**
         * The currently attached overlay view (if any). Held statically so
         * [hideOverlay] can remove it from any context, including from
         * AlarmActivity when the real alarm screen takes over.
         */
        @Volatile
        private var overlayView: View? = null

        /**
         * The currently running service instance (if any). Held statically so
         * [hideOverlay] — which may be invoked from AlarmActivity — can cancel
         * the overlay's pending hold-to-confirm runnables on the right instance.
         */
        @Volatile
        private var runningInstance: AlarmForegroundService? = null

        fun start(
            context: Context,
            label: String,
            instanceId: String? = null,
            silent: Boolean = false,
            repeatCount: Int = 0,
            ringtoneUri: String? = null,
        ) {
            val intent = Intent(context, AlarmForegroundService::class.java).apply {
                putExtra("label", label)
                instanceId?.let { putExtra("instanceId", it) }
                putExtra("silent", silent)
                putExtra("repeatCount", repeatCount)
                ringtoneUri?.let { putExtra("ringtoneUri", it) }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, AlarmForegroundService::class.java))
        }

        /**
         * Removes the SYSTEM_ALERT_WINDOW overlay if one is attached.
         * Safe and idempotent: no-op when nothing is shown.
         */
        fun hideOverlay(context: Context) {
            val view = overlayView ?: return
            overlayView = null
            // Cancel any in-flight hold-to-confirm work BEFORE removing the
            // view: otherwise a pending confirmRunnable could fire spuriously
            // (emit alarmConfirmed + stopSelf from a torn-down overlay),
            // e.g. when AlarmActivity takes over mid-hold.
            runningInstance?.cancelOverlayHold()
            try {
                val windowManager = context.applicationContext
                    .getSystemService(Context.WINDOW_SERVICE) as WindowManager
                windowManager.removeView(view)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to remove alarm overlay", e)
            }
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private val ringtoneManager = AlarmRingtoneManager(this)
    private var currentInstanceId: String? = null

    // Overlay hold-to-confirm bookkeeping (main-thread Handler).
    private val holdHandler = Handler(Looper.getMainLooper())
    private var holdProgressRunnable: Runnable? = null
    private var holdConfirmRunnable: Runnable? = null
    private var overlayConfirmed = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        runningInstance = this
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val label = intent?.getStringExtra("label") ?: "FCK-ADHD Alarm"
        val instanceId = intent?.getStringExtra("instanceId")
        val silent = intent?.getBooleanExtra("silent", false) ?: false
        val repeatCount = intent?.getIntExtra("repeatCount", 0) ?: 0
        val hasRingtoneExtra = intent?.hasExtra("ringtoneUri") == true
        val ringtoneUri = intent?.getStringExtra("ringtoneUri")?.let { Uri.parse(it) }

        currentInstanceId = instanceId ?: currentInstanceId

        acquireWakeLock()
        startForeground(
            NOTIFICATION_ID,
            buildNotification(label, instanceId, silent, repeatCount, intent?.getStringExtra("ringtoneUri")),
        )

        if (!silent) {
            // Exclusive audio focus pauses other apps' audio (YouTube & co.)
            // for as long as the alarm is unacknowledged.
            AudioController.getInstance(this).requestFocus()
            if (ringtoneManager.isCurrentlyPlaying()) {
                // 60s repeat delivery: switch tone only when the intent
                // EXPLICITLY carries a ringtoneUri (escalation from repeat #3).
                // An absent extra on a re-delivery must never revert the
                // currently playing (escalation) tone back to the default.
                if (hasRingtoneExtra) {
                    ringtoneManager.switchTo(ringtoneUri)
                }
            } else {
                ringtoneManager.start(ringtoneUri)
            }
        } else {
            // Silent reminder: never hold focus, stop any leftover playback.
            ringtoneManager.stop()
        }

        evaluateOverlay(label, repeatCount)

        return START_NOT_STICKY
    }

    override fun onDestroy() {
        if (runningInstance == this) runningInstance = null
        ringtoneManager.stop()
        AudioController.getInstance(this).releaseFocus()
        hideOverlay(this)
        holdHandler.removeCallbacksAndMessages(null)
        releaseWakeLock()
        super.onDestroy()
    }

    /**
     * Cancels the overlay's hold-to-confirm progress/confirm runnables and
     * resets the confirmed flag. Invoked by [hideOverlay] whenever the overlay
     * is removed mid-hold so no pending confirm can fire against a torn-down
     * overlay. Safe to call repeatedly.
     */
    private fun cancelOverlayHold() {
        holdConfirmRunnable?.let { holdHandler.removeCallbacks(it) }
        holdProgressRunnable?.let { holdHandler.removeCallbacks(it) }
        holdProgressRunnable = null
        overlayConfirmed = false
    }

    // ── SYSTEM_ALERT_WINDOW overlay ──────────────────────────────────────────

    /**
     * Shows the full-screen overlay over other apps — but ONLY when every
     * precondition holds:
     *  1. the screen is actually on (PowerManager.isInteractive),
     *  2. the device is NOT locked (KeyguardManager.isKeyguardLocked == false),
     *  3. the SYSTEM_ALERT_WINDOW permission is granted,
     *  4. AlarmActivity is NOT already visible (it takes precedence).
     * Re-evaluated on every 60s repeat delivery; if the activity is up the
     * overlay is removed instead.
     */
    private fun evaluateOverlay(label: String, repeatCount: Int) {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager

        if (!powerManager.isInteractive || keyguardManager.isKeyguardLocked) {
            // Screen off / locked: the full-screen intent on the notification
            // owns the display — drop any overlay left from a prior delivery.
            hideOverlay(this)
            return
        }

        if (AlarmActivity.instance != null) {
            // The real alarm screen is visible — it hides the overlay itself,
            // but guard here too against double display.
            hideOverlay(this)
            return
        }

        if (!Settings.canDrawOverlays(this)) {
            Log.w(TAG, "SYSTEM_ALERT_WINDOW not granted — overlay skipped")
            return
        }

        showOrUpdateOverlay(label, repeatCount)
    }

    private fun showOrUpdateOverlay(label: String, repeatCount: Int) {
        val view = overlayView
        if (view != null) {
            // Repeat delivery while the overlay is still up: refresh texts.
            view.findViewById<TextView>(R.id.overlay_label).text = label
            view.findViewById<TextView>(R.id.overlay_repeat).text = repeatText(repeatCount)
            return
        }

        val inflater = getSystemService(Context.LAYOUT_INFLATER_SERVICE) as LayoutInflater
        val newView = inflater.inflate(R.layout.alarm_overlay, null)

        newView.findViewById<TextView>(R.id.overlay_label).text = label
        newView.findViewById<TextView>(R.id.overlay_repeat).text = repeatText(repeatCount)

        setupOverlayHoldConfirm(newView.findViewById(R.id.overlay_confirm_hold))
        setupOverlayExtend(newView.findViewById(R.id.overlay_extend))

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        // Deliberately NO FLAG_NOT_FOCUSABLE / FLAG_NOT_TOUCHABLE:
        // the hold-to-confirm and extend buttons must receive touches.
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
            PixelFormat.TRANSLUCENT,
        )

        try {
            val windowManager =
                applicationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            windowManager.addView(newView, params)
            overlayView = newView
        } catch (e: Exception) {
            Log.e(TAG, "Failed to add alarm overlay", e)
        }
    }

    private fun repeatText(repeatCount: Int): String {
        return if (repeatCount > 0) "Wiederholung #$repeatCount" else "Erster Alarm"
    }

    /**
     * Hold-to-confirm on the overlay — same 2-second pattern as
     * AlarmActivity.setupHoldConfirmButton. Completing the hold confirms the
     * alarm: emits `alarmConfirmed` to the web layer and stops this service
     * (onDestroy then stops ringtone, releases focus and removes the overlay,
     * so other apps' audio resumes).
     */
    private fun setupOverlayHoldConfirm(button: TextView) {
        val startText = button.text

        val confirmRunnable = Runnable {
            if (overlayConfirmed) return@Runnable
            overlayConfirmed = true
            button.text = "BESTÄTIGT"
            currentInstanceId?.let { BlockerPlugin.emitAlarmConfirmed(it) }
            stopSelf()
        }
        holdConfirmRunnable = confirmRunnable

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
                    holdConfirmRunnable?.let { holdHandler.removeCallbacks(it) }
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

    /**
     * "VERLÄNGERN" on the overlay: notifies the web layer, stores the pending
     * extend request and brings the app to the foreground. A visible
     * SYSTEM_ALERT_WINDOW grants the background-activity-launch exemption, so
     * startActivity succeeds even when the alarm fired from background.
     */
    private fun setupOverlayExtend(button: TextView) {
        button.setOnClickListener {
            val instanceId = currentInstanceId ?: return@setOnClickListener
            BlockerPlugin.emitAlarmExtendRequested(instanceId)
            BlockerPlugin.setPendingExtendRequest(this, instanceId)

            val mainIntent = Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            try {
                startActivity(mainIntent)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to launch MainActivity from overlay", e)
            }
        }
    }

    // ── Notification ──────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "FCK-ADHD Alarme",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Alarm-Benachrichtigungen für FCK-ADHD Routinen"
                enableVibration(true)
                setBypassDnd(true)
            }

            // Silent-mode reminders get a genuinely quiet channel: low
            // importance, no sound, no vibration, no DND bypass.
            val silentChannel = NotificationChannel(
                CHANNEL_ID_SILENT,
                "FCK-ADHD Stille Erinnerungen",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Stille Erinnerungen für FCK-ADHD Routinen"
                enableVibration(false)
                setSound(null, null)
            }

            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
            notificationManager.createNotificationChannel(silentChannel)
        }
    }

    private fun buildNotification(
        label: String,
        instanceId: String?,
        silent: Boolean,
        repeatCount: Int,
        ringtoneUri: String?,
    ): Notification {
        // Intent straight to the alarm screen so tapping (or the system's
        // full-screen launch) lands on a fully-populated AlarmActivity,
        // not the web view. The ringtoneUri is threaded through too: without
        // it a full-screen/tap launch on an escalation repeat would hand the
        // FGS a null ringtone and revert the playing escalation tone to the
        // default alarm sound.
        val alarmIntent = Intent(this, AlarmActivity::class.java).apply {
            putExtra("label", label)
            instanceId?.let { putExtra("instanceId", it) }
            putExtra("silent", silent)
            putExtra("repeatCount", repeatCount)
            ringtoneUri?.let { putExtra("ringtoneUri", it) }
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            alarmIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        // Silent deliveries post on the dedicated low-importance channel —
        // no sound, no vibration, no heads-up — so soft reminders stay soft.
        if (silent) {
            return NotificationCompat.Builder(this, CHANNEL_ID_SILENT)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle("FCK-ADHD Alarm")
                .setContentText(label)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setSilent(true)
                .setContentIntent(pendingIntent)
                .setFullScreenIntent(pendingIntent, true)
                .build()
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("FCK-ADHD Alarm")
            .setContentText(label)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(pendingIntent)
            // Full-screen intent: lets the system launch AlarmActivity directly
            // when the device is locked or the USE_FULL_SCREEN_INTENT quota
            // applies (requires android.permission.USE_FULL_SCREEN_INTENT).
            .setFullScreenIntent(pendingIntent, true)
            .build()
    }

    // ── Wake lock ─────────────────────────────────────────────────────────────

    private fun acquireWakeLock() {
        // Only skip when the lock is still actually held. The 10-minute timeout
        // auto-releases it, so on the endless repeat chain the lock must be
        // (re)created/acquired again — otherwise audio stalls after expiry.
        if (wakeLock?.isHeld == true) return

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            WAKE_LOCK_TAG,
        ).apply {
            acquire(10 * 60 * 1000L) // 10 minute timeout safety
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        wakeLock = null
    }
}

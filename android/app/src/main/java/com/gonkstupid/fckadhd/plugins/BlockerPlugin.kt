package com.gonkstupid.fckadhd.plugins

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject
import com.gonkstupid.fckadhd.AlarmActivity
import com.gonkstupid.fckadhd.AlarmForegroundService
import com.gonkstupid.fckadhd.AlarmScheduler
import com.gonkstupid.fckadhd.AudioController
import java.io.File
import java.lang.ref.WeakReference

@CapacitorPlugin(
    name = "BlockerPlugin",
    permissions = [
        Permission(
            strings = [Manifest.permission.POST_NOTIFICATIONS],
            alias = "notifications"
        ),
        Permission(
            strings = [Manifest.permission.WRITE_EXTERNAL_STORAGE],
            alias = "storage"
        )
    ]
)
class BlockerPlugin : Plugin() {

    companion object {
        /**
         * Native→Web event channel.
         *
         * AlarmReceiver / BootReceiver are BroadcastReceivers with no access to
         * a live plugin instance, so this plugin registers a weak reference to
         * itself in [load]. The static [emitAlarmFired] entry point posts the
         * `alarmFired` event to every live instance on the main thread.
         * If no WebView is alive the event is simply dropped — the native
         * alarm chain is never affected.
         */
        private val instances =
            java.util.Collections.synchronizedSet(mutableSetOf<WeakReference<BlockerPlugin>>())

        private val mainHandler = Handler(Looper.getMainLooper())

        /** Emits `alarmFired` { instanceId: string, repeatCount: number } to the web layer. */
        fun emitAlarmFired(instanceId: String, repeatCount: Int) {
            mainHandler.post {
                synchronized(instances) {
                    instances.removeAll { it.get() == null }
                    for (ref in instances) {
                        val plugin = ref.get() ?: continue
                        val data = JSObject()
                        data.put("instanceId", instanceId)
                        data.put("repeatCount", repeatCount)
                        plugin.notifyListeners("alarmFired", data)
                    }
                }
            }
        }

        /** Emits `alarmConfirmed` { instanceId: string } to the web layer. */
        fun emitAlarmConfirmed(instanceId: String) {
            mainHandler.post {
                synchronized(instances) {
                    instances.removeAll { it.get() == null }
                    for (ref in instances) {
                        val plugin = ref.get() ?: continue
                        val data = JSObject()
                        data.put("instanceId", instanceId)
                        plugin.notifyListeners("alarmConfirmed", data)
                    }
                }
            }
        }
    }

    override fun load() {
        instances.add(WeakReference(this))
    }

    private val audioController: AudioController by lazy {
        AudioController(context)
    }

    private val alarmScheduler: AlarmScheduler by lazy {
        AlarmScheduler(context)
    }

    // ── Alarm display ─────────────────────────────────────────────────────────

    @PluginMethod
    fun showAlarm(call: PluginCall) {
        val label = call.getString("label") ?: "Alarm"
        val repeatCount = call.getInt("repeatCount") ?: 0
        val silent = call.getBoolean("silent") ?: false
        val instanceId = call.getString("instanceId")

        val intent = Intent(context, AlarmActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra("label", label)
            putExtra("repeatCount", repeatCount)
            putExtra("silent", silent)
            instanceId?.let { putExtra("instanceId", it) }
        }

        bridge.activity?.runOnUiThread {
            context.startActivity(intent)
        }

        call.resolve()
    }

    @PluginMethod
    fun dismissAlarm(call: PluginCall) {
        bridge.activity?.runOnUiThread {
            AlarmActivity.instance?.finish()
        }
        AlarmForegroundService.stop(context)
        call.resolve()
    }

    // ── Audio focus ───────────────────────────────────────────────────────────

    @PluginMethod
    fun requestAudioFocus(call: PluginCall) {
        audioController.requestFocus()
        call.resolve()
    }

    @PluginMethod
    fun releaseAudioFocus(call: PluginCall) {
        audioController.releaseFocus()
        call.resolve()
    }

    // ── Scheduling ────────────────────────────────────────────────────────────

    /**
     * Schedules an exact alarm. Accepts an optional `label` and an optional
     * `repeatCount` (both backward compatible). If `repeatCount` is provided
     * it is persisted; if absent the existing persisted repeat count is kept
     * (0 for brand-new alarms).
     */
    @PluginMethod
    fun scheduleExactAlarm(call: PluginCall) {
        val instanceId = call.getString("instanceId")
        val deadlineMs = call.getLong("deadlineMs")

        if (instanceId == null || deadlineMs == null) {
            call.reject("instanceId and deadlineMs are required")
            return
        }

        val label = call.getString("label")
        val repeatCount = call.getInt("repeatCount") // null when not provided
        val silent = call.getBoolean("silent") // null when not provided

        alarmScheduler.scheduleExact(instanceId, deadlineMs, label, repeatCount)
        alarmScheduler.persistDeadline(instanceId, deadlineMs)
        if (silent != null) {
            alarmScheduler.persistSilent(instanceId, silent)
        }

        val result = JSObject()
        result.put("scheduled", alarmScheduler.wasExactAlarmGranted())
        call.resolve(result)
    }

    @PluginMethod
    fun cancelAlarm(call: PluginCall) {
        val instanceId = call.getString("instanceId")
        if (instanceId == null) {
            call.reject("instanceId is required")
            return
        }

        // cancel() also removes ALL persisted metadata (deadline, label,
        // repeat count) — cancelling stops the entire repeat chain.
        alarmScheduler.cancel(instanceId)
        call.resolve()
    }

    @PluginMethod
    fun isAlarmScheduled(call: PluginCall) {
        val instanceId = call.getString("instanceId")
        if (instanceId == null) {
            call.reject("instanceId is required")
            return
        }

        val scheduled = alarmScheduler.isScheduled(instanceId)
        val result = JSObject()
        result.put("scheduled", scheduled)
        call.resolve(result)
    }

    // ── Permissions: notifications ───────────────────────────────────────────

    /** Resolves { granted: boolean }. */
    @PluginMethod
    fun checkNotificationPermission(call: PluginCall) {
        val granted = NotificationManagerCompat.from(context).areNotificationsEnabled()

        val result = JSObject()
        result.put("granted", granted)
        call.resolve(result)
    }

    /**
     * Resolves { granted: boolean }. True on API < 33 (no permission needed).
     * Resolves granted=false (no crash) when no activity is available.
     */
    @PluginMethod
    fun requestNotificationPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            val result = JSObject()
            result.put("granted", true)
            call.resolve(result)
            return
        }

        if (NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            val result = JSObject()
            result.put("granted", true)
            call.resolve(result)
            return
        }

        val activity = getActivity()
        if (activity == null) {
            val result = JSObject()
            result.put("granted", false)
            call.resolve(result)
            return
        }

        requestPermissionForAlias("notifications", call, "notificationPermissionResult")
    }

    /** Callback invoked by Capacitor after the POST_NOTIFICATIONS dialog closes. */
    @PermissionCallback
    private fun notificationPermissionResult(call: PluginCall) {
        val granted = getPermissionState("notifications") == PermissionState.GRANTED

        val result = JSObject()
        result.put("granted", granted)
        call.resolve(result)
    }

    // ── Permissions: exact alarms & full-screen intents ───────────────────────

    /** Resolves { granted: boolean }. True on API < 31 (no permission needed). */
    @PluginMethod
    fun hasExactAlarmPermission(call: PluginCall) {
        val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            alarmManager.canScheduleExactAlarms()
        } else {
            true
        }

        val result = JSObject()
        result.put("granted", granted)
        call.resolve(result)
    }

    /** Resolves { granted: boolean }. True on API < 34 (no permission needed). */
    @PluginMethod
    fun canUseFullScreenIntent(call: PluginCall) {
        val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val notificationManager =
                context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.canUseFullScreenIntent()
        } else {
            true
        }

        val result = JSObject()
        result.put("granted", granted)
        call.resolve(result)
    }

    /** Opens the system screen to grant SCHEDULE_EXACT_ALARM (API 31+). */
    @PluginMethod
    fun openExactAlarmSettings(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
                data = Uri.parse("package:${context.packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        }
        call.resolve()
    }

    /** Opens the system screen to grant USE_FULL_SCREEN_INTENT (API 34+). */
    @PluginMethod
    fun openFullScreenIntentSettings(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
                data = Uri.parse("package:${context.packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        }
        call.resolve()
    }

    // ── Ringtones ─────────────────────────────────────────────────────────────

    /** Resolves { ringtones: [{ uri, title }] } with all ALARM-type ringtones. */
    @PluginMethod
    fun listRingtones(call: PluginCall) {
        try {
            val ringtoneManager = RingtoneManager(context)
            ringtoneManager.setType(RingtoneManager.TYPE_ALARM)

            val ringtones = JSArray()
            // cursor.use {} guarantees the cursor is closed on every path,
            // including when an exception is thrown while reading it.
            ringtoneManager.cursor.use { cursor ->
                if (cursor.moveToFirst()) {
                    do {
                        val title = cursor.getString(RingtoneManager.TITLE_COLUMN_INDEX)
                        val uri = ringtoneManager.getRingtoneUri(cursor.position)
                        val entry = JSObject()
                        entry.put("uri", uri.toString())
                        entry.put("title", title)
                        ringtones.put(entry)
                    } while (cursor.moveToNext())
                }
            }

            val result = JSObject()
            result.put("ringtones", ringtones)
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("Failed to list ringtones: ${e.message}")
        }
    }

    /** Stores the escalation ringtone URI (used by AlarmReceiver from repeat #3). */
    @PluginMethod
    fun setEscalationRingtone(call: PluginCall) {
        val uri = call.getString("uri")
        if (uri == null) {
            call.reject("uri is required")
            return
        }

        alarmScheduler.setEscalationRingtoneUri(uri)
        call.resolve()
    }

    /** Resolves { uri: string | null }. */
    @PluginMethod
    fun getEscalationRingtone(call: PluginCall) {
        val result = JSObject()
        val uri = alarmScheduler.getEscalationRingtoneUri()
        if (uri == null) {
            result.put("uri", JSONObject.NULL)
        } else {
            result.put("uri", uri)
        }
        call.resolve(result)
    }

    // ── Battery optimization ──────────────────────────────────────────────────

    @PluginMethod
    fun requestBatteryOptimizationExemption(call: PluginCall) {
        val activity = bridge.activity
        if (activity == null) {
            call.reject("Activity not available")
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:${context.packageName}")
            }
            activity.startActivity(intent)
        }

        call.resolve()
    }

    // ─── Gallery export ────────────────────────────────────────────────

    /**
     * Saves a PNG data URL into the public pictures directory
     * (Pictures/FCK-ADHD) so it shows up in Google Photos & co.
     * API 29+: MediaStore insert, no runtime permission required.
     * API 24–28: WRITE_EXTERNAL_STORAGE via the "storage" permission alias.
     */
    @PluginMethod
    fun saveImageToGallery(call: PluginCall) {
        val dataUrl = call.getString("dataUrl")
        if (dataUrl == null || !dataUrl.contains(',')) {
            call.reject("dataUrl fehlt oder ist ungültig")
            return
        }
        val bytes = try {
            Base64.decode(
                dataUrl.substringAfter(','),
                Base64.DEFAULT
            )
        } catch (e: IllegalArgumentException) {
            call.reject("Base64-Dekodierung fehlgeschlagen", e)
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveViaMediaStore(call, bytes)
        } else if (getPermissionState("storage") == PermissionState.GRANTED) {
            saveViaLegacyStorage(call, bytes)
        } else {
            requestPermissionForAlias("storage", call, "storagePermissionResult")
        }
    }

    /** Callback invoked by Capacitor after the WRITE_EXTERNAL_STORAGE dialog closes. */
    @PermissionCallback
    private fun storagePermissionResult(call: PluginCall) {
        val dataUrl = call.getString("dataUrl") ?: run {
            call.reject("dataUrl fehlt oder ist ungültig")
            return
        }
        val bytes = try {
            Base64.decode(
                dataUrl.substringAfter(','),
                Base64.DEFAULT
            )
        } catch (e: IllegalArgumentException) {
            call.reject("Base64-Dekodierung fehlgeschlagen", e)
            return
        }
        if (getPermissionState("storage") == PermissionState.GRANTED) {
            saveViaLegacyStorage(call, bytes)
        } else {
            call.reject("Storage-Permission verweigert")
        }
    }

    private fun saveViaMediaStore(call: PluginCall, bytes: ByteArray) {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(
                MediaStore.Images.Media.DISPLAY_NAME,
                "FCK-ADHD-QR-${System.currentTimeMillis()}.png"
            )
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(
                MediaStore.Images.Media.RELATIVE_PATH,
                "${Environment.DIRECTORY_PICTURES}/FCK-ADHD"
            )
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val uri = resolver.insert(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            values
        ) ?: run {
            call.reject("MediaStore-Insert fehlgeschlagen")
            return
        }

        try {
            val stream = resolver.openOutputStream(uri)
            if (stream == null) {
                resolver.delete(uri, null, null)
                call.reject("OutputStream nicht verfügbar")
                return
            }
            stream.use { it.write(bytes) }
            values.clear()
            values.put(MediaStore.Images.Media.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } catch (e: Exception) {
            // Delete the orphaned IS_PENDING row so nothing stale
            // lingers in MediaStore after a failed write/update.
            resolver.delete(uri, null, null)
            call.reject("Speichern fehlgeschlagen", e)
            return
        }

        val result = JSObject()
        result.put("saved", true)
        result.put("uri", uri.toString())
        call.resolve(result)
    }

    private fun saveViaLegacyStorage(call: PluginCall, bytes: ByteArray) {
        try {
            @Suppress("DEPRECATION")
            val dir = File(
                Environment.getExternalStoragePublicDirectory(
                    Environment.DIRECTORY_PICTURES
                ),
                "FCK-ADHD"
            )
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("Verzeichnis konnte nicht angelegt werden")
                return
            }
            val file = File(dir, "FCK-ADHD-QR-${System.currentTimeMillis()}.png")
            file.writeBytes(bytes)
            MediaScannerConnection.scanFile(
                context,
                arrayOf(file.absolutePath),
                null,
                null
            )
            val result = JSObject()
            result.put("saved", true)
            result.put("uri", Uri.fromFile(file).toString())
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("Speichern fehlgeschlagen", e)
        }
    }
}

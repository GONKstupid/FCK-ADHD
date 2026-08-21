package com.gonkstupid.fckadhd.plugins

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.gonkstupid.fckadhd.AlarmActivity
import com.gonkstupid.fckadhd.AlarmForegroundService
import com.gonkstupid.fckadhd.AlarmScheduler
import com.gonkstupid.fckadhd.AudioController

@CapacitorPlugin(name = "BlockerPlugin")
class BlockerPlugin : Plugin() {

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

        val intent = Intent(context, AlarmActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra("label", label)
            putExtra("repeatCount", repeatCount)
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

    @PluginMethod
    fun scheduleExactAlarm(call: PluginCall) {
        val instanceId = call.getString("instanceId")
        val deadlineMs = call.getLong("deadlineMs")

        if (instanceId == null || deadlineMs == null) {
            call.reject("instanceId and deadlineMs are required")
            return
        }

        alarmScheduler.scheduleExact(instanceId, deadlineMs)
        alarmScheduler.persistDeadline(instanceId, deadlineMs)
        call.resolve()
    }

    @PluginMethod
    fun cancelAlarm(call: PluginCall) {
        val instanceId = call.getString("instanceId")
        if (instanceId == null) {
            call.reject("instanceId is required")
            return
        }

        alarmScheduler.cancel(instanceId)
        alarmScheduler.removeDeadline(instanceId)
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
}

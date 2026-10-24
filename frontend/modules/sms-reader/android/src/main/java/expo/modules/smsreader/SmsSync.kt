package expo.modules.smsreader

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object SmsSync {
  private const val CHANNEL = "spendsense_alerts"
  private val FIN = Regex("(?i)(rs\\.?\\s?\\d|inr|₹|debited|credited|spent|upi|a/c|acct|card)")

  fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences("spendsense_sms", Context.MODE_PRIVATE)

  // Personal numbers are skipped; banks use alphanumeric sender IDs like AD-HDFCBK.
  fun looksFinancial(sender: String, body: String): Boolean {
    val s = sender.replace(" ", "")
    if (Regex("^\\+?\\d{8,15}$").matches(s)) return false
    return FIN.containsMatchIn(body)
  }

  fun post(ctx: Context, sender: String, body: String, ts: Long): Boolean {
    val p = prefs(ctx)
    val url = p.getString("url", null) ?: return false
    val token = p.getString("token", null) ?: return false
    return try {
      val conn = (URL("$url/api/sms/ingest").openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 15000
        readTimeout = 20000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("Authorization", "Bearer $token")
      }
      val msg = JSONObject().put("sender", sender).put("body", body).put("received_at", ts.toDouble())
      val payload = JSONObject().put("messages", JSONArray().put(msg))
      conn.outputStream.use { it.write(payload.toString().toByteArray()) }
      val code = conn.responseCode
      if (code in 200..299) {
        val text = conn.inputStream.bufferedReader().use { it.readText() }
        notifyAlerts(ctx, JSONObject(text).optJSONArray("alerts"))
        true
      } else code == 401 // drop on auth failure; user will re-login
    } catch (_: Exception) {
      false
    }
  }

  fun queue(ctx: Context, sender: String, body: String, ts: Long) {
    val p = prefs(ctx)
    val arr = JSONArray(p.getString("pending", "[]"))
    arr.put(JSONObject().put("sender", sender).put("body", body).put("received_at", ts.toDouble()))
    p.edit().putString("pending", arr.toString()).apply()
  }

  fun drain(ctx: Context): List<Map<String, Any?>> {
    val p = prefs(ctx)
    val arr = JSONArray(p.getString("pending", "[]"))
    p.edit().putString("pending", "[]").apply()
    val out = mutableListOf<Map<String, Any?>>()
    for (i in 0 until arr.length()) {
      val o = arr.getJSONObject(i)
      out.add(mapOf("sender" to o.optString("sender"), "body" to o.optString("body"), "received_at" to o.optDouble("received_at")))
    }
    return out
  }

  private fun notifyAlerts(ctx: Context, alerts: JSONArray?) {
    if (alerts == null || alerts.length() == 0) return
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "Budget alerts", NotificationManager.IMPORTANCE_HIGH))
    }
    val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
    val pi = launch?.let { PendingIntent.getActivity(ctx, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
    for (i in 0 until alerts.length()) {
      val a = alerts.getJSONObject(i)
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) android.app.Notification.Builder(ctx, CHANNEL)
        else @Suppress("DEPRECATION") android.app.Notification.Builder(ctx)
      val n = builder
        .setSmallIcon(ctx.applicationInfo.icon)
        .setContentTitle(a.optString("title"))
        .setContentText(a.optString("message"))
        .setStyle(android.app.Notification.BigTextStyle().bigText(a.optString("message")))
        .setAutoCancel(true)
        .apply { if (pi != null) setContentIntent(pi) }
        .build()
      try {
        nm.notify(a.optString("id").hashCode(), n)
      } catch (_: SecurityException) {
      }
    }
    // remember ids so the JS side doesn't notify twice
    val p = prefs(ctx)
    val seen = JSONArray(p.getString("notified", "[]"))
    for (i in 0 until alerts.length()) seen.put(alerts.getJSONObject(i).optString("id"))
    p.edit().putString("notified", seen.toString()).apply()
  }
}

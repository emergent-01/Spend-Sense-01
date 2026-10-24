package expo.modules.smsreader

import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SmsReaderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SmsReader")
    Events("onSms")

    OnStartObserving {
      SmsReceiver.listener = { m -> sendEvent("onSms", m) }
    }
    OnStopObserving {
      SmsReceiver.listener = null
    }

    AsyncFunction("readInbox") { sinceMs: Double, limit: Int ->
      val ctx = appContext.reactContext ?: throw IllegalStateException("No context")
      val out = mutableListOf<Map<String, Any?>>()
      val cursor = ctx.contentResolver.query(
        Uri.parse("content://sms/inbox"),
        arrayOf("address", "body", "date"),
        "date >= ?",
        arrayOf(sinceMs.toLong().toString()),
        "date DESC"
      )
      cursor?.use { c ->
        val ia = c.getColumnIndex("address")
        val ib = c.getColumnIndex("body")
        val id = c.getColumnIndex("date")
        while (c.moveToNext() && out.size < limit) {
          val sender = c.getString(ia) ?: ""
          val body = c.getString(ib) ?: ""
          if (SmsSync.looksFinancial(sender, body)) {
            out.add(mapOf("sender" to sender, "body" to body, "received_at" to c.getLong(id).toDouble()))
          }
        }
      }
      out
    }

    Function("configureSync") { url: String, token: String ->
      val ctx = appContext.reactContext ?: return@Function null
      SmsSync.prefs(ctx).edit().putString("url", url).putString("token", token).apply()
      null
    }

    Function("clearSync") {
      val ctx = appContext.reactContext ?: return@Function null
      SmsSync.prefs(ctx).edit().remove("token").apply()
      null
    }

    AsyncFunction("drainPending") {
      val ctx = appContext.reactContext ?: throw IllegalStateException("No context")
      SmsSync.drain(ctx)
    }
  }
}

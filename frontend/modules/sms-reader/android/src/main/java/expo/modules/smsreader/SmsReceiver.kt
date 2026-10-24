package expo.modules.smsreader

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

// Captures new SMS in the background, even when the app is closed.
// Financial-looking messages are posted straight to the SpendSense backend;
// if offline they are queued and synced next time the app opens.
class SmsReceiver : BroadcastReceiver() {
  companion object {
    var listener: ((Map<String, Any?>) -> Unit)? = null
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
    if (parts.isEmpty()) return
    val sender = parts[0].originatingAddress ?: ""
    val body = parts.joinToString("") { it.messageBody ?: "" }
    val ts = parts[0].timestampMillis
    if (!SmsSync.looksFinancial(sender, body)) return
    val pending = goAsync()
    Thread {
      try {
        val ok = SmsSync.post(context.applicationContext, sender, body, ts)
        if (!ok) SmsSync.queue(context.applicationContext, sender, body, ts)
        listener?.invoke(mapOf("sender" to sender, "body" to body, "received_at" to ts.toDouble(), "synced" to ok))
      } catch (_: Exception) {
      } finally {
        pending.finish()
      }
    }.start()
  }
}

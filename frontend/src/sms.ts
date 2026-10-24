import { Linking, PermissionsAndroid, Platform } from "react-native";
import { SmsReader, type RawSms } from "@/modules/sms-reader";
import { api, BASE_URL } from "@/src/api";
import { storage } from "@/src/utils/storage";

export const isAndroid = Platform.OS === "android";
// true only in an installed Android build (not Expo Go / web)
export const smsNativeAvailable = !!SmsReader;
export const BACKFILL_KEY = "sms_backfill_done";

export type SmsPermission = "granted" | "denied" | "blocked" | "unavailable";

export async function checkSmsPermission(): Promise<SmsPermission> {
  if (!isAndroid) return "unavailable";
  const read = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
  const recv = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
  return read && recv ? "granted" : "denied";
}

export async function requestSmsPermission(): Promise<SmsPermission> {
  if (!isAndroid) return "unavailable";
  const res = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.READ_SMS,
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
  ]);
  const vals = Object.values(res);
  if (vals.every((v) => v === PermissionsAndroid.RESULTS.GRANTED)) return "granted";
  if (vals.some((v) => v === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)) return "blocked";
  return "denied";
}

export const openAppSettings = () => Linking.openSettings();

export type IngestResult = { created: number; merged: number; review: number; ignored: number; duplicate: number; processed: number; alerts: any[] };

export async function ingest(messages: RawSms[] | { body: string; sender?: string; received_at?: number }[]): Promise<IngestResult> {
  return api<IngestResult>("/sms/ingest", { method: "POST", body: { messages } });
}

export async function backfill(onProgress: (done: number, total: number) => void): Promise<IngestResult> {
  const total: IngestResult = { created: 0, merged: 0, review: 0, ignored: 0, duplicate: 0, processed: 0, alerts: [] };
  if (!SmsReader) return total;
  const since = Date.now() - 365 * 24 * 3600 * 1000;
  // oldest first so recurring/budget logic sees history in order
  const msgs = (await SmsReader.readInbox(since, 20000)).reverse();
  const size = 200;
  for (let i = 0; i < msgs.length; i += size) {
    const r = await ingest(msgs.slice(i, i + size));
    (Object.keys(total) as (keyof IngestResult)[]).forEach((k) => {
      if (k === "alerts") total.alerts.push(...r.alerts);
      else total[k] += r[k] as number;
    });
    onProgress(Math.min(i + size, msgs.length), msgs.length);
  }
  if (!msgs.length) onProgress(0, 0);
  await storage.setItem(BACKFILL_KEY, true);
  return total;
}

export function configureNativeSync(token: string | null) {
  if (!SmsReader) return;
  if (token) SmsReader.configureSync(BASE_URL, token);
  else SmsReader.clearSync();
}

export async function drainPending(): Promise<number> {
  if (!SmsReader) return 0;
  const pending = await SmsReader.drainPending();
  if (pending.length) await ingest(pending);
  return pending.length;
}

export function subscribeLiveSms(cb: (m: RawSms) => void): () => void {
  if (!SmsReader) return () => {};
  const sub = SmsReader.addListener("onSms", cb);
  return () => sub.remove();
}

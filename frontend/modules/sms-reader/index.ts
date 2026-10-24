// Local Expo module: reads the Android SMS inbox and captures new SMS live.
// Only present in an installed Android build; null in Expo Go, iOS and web.
import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

export type RawSms = { sender: string; body: string; received_at: number };

type SmsReaderNative = {
  readInbox(sinceMs: number, limit: number): Promise<RawSms[]>;
  configureSync(url: string, token: string): void;
  clearSync(): void;
  drainPending(): Promise<RawSms[]>;
  addListener(event: "onSms", cb: (m: RawSms) => void): { remove(): void };
};

export const SmsReader: SmsReaderNative | null =
  Platform.OS === "android" ? requireOptionalNativeModule<SmsReaderNative>("SmsReader") : null;

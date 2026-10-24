import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/src/auth";
import { drainPending, subscribeLiveSms, ingest } from "@/src/sms";
import { syncAlertNotifications } from "@/src/notify";

// Keeps the app in sync while signed in: drains SMS captured in the background,
// listens for live SMS while open, and raises phone notifications for new alerts.
export function SyncBridge() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const busy = useRef(false);

  useEffect(() => {
    if (!user) return;
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const n = await drainPending();
        if (n) qc.invalidateQueries();
        await syncAlertNotifications();
      } catch {
      } finally {
        busy.current = false;
      }
    };
    tick();
    const appSub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        tick();
        qc.invalidateQueries();
      }
    });
    const unsub = subscribeLiveSms(async (m: any) => {
      try {
        if (!m.synced) await ingest([{ sender: m.sender, body: m.body, received_at: m.received_at }]);
      } catch {}
      qc.invalidateQueries();
    });
    return () => {
      appSub.remove();
      unsub();
    };
  }, [user, qc]);

  return null;
}

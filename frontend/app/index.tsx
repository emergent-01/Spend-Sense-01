import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { useAuth } from "@/src/auth";
import { Loading } from "@/src/components/ui";
import { storage } from "@/src/utils/storage";
import { BACKFILL_KEY, smsNativeAvailable } from "@/src/sms";

export default function Index() {
  const { user, loading } = useAuth();
  const [backfilled, setBackfilled] = useState<boolean | null>(null);
  useEffect(() => {
    storage.getItem(BACKFILL_KEY, false).then((v) => setBackfilled(!!v));
  }, [user]);
  if (loading || backfilled === null) return <Loading />;
  if (!user) return <Redirect href="/login" />;
  if (smsNativeAvailable && !backfilled) return <Redirect href="/sms-setup" />;
  return <Redirect href="/(tabs)" />;
}

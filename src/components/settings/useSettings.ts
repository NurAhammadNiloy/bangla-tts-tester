"use client";

import { useSyncExternalStore } from "react";
import { getServerSettings, getSettings, subscribe, type AppSettings } from "@/lib/settings";

/** Live settings for client components (defaults during SSR and the first paint). */
export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribe, getSettings, getServerSettings);
}

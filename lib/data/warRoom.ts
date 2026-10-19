import "server-only";

import { isIsoDate } from "@/lib/format/ist";
import { WarRoomRow } from "@/lib/types/schemas";
import { runSource } from "./run";

/** Intraday pacing: today up to `cutoffMinute` (IST) vs the same time of day on previous days (see war_room.sql). */
export function getWarRoom(today: string, cutoffMinute: number) {
  if (!isIsoDate(today) || !Number.isInteger(cutoffMinute) || cutoffMinute < 0 || cutoffMinute > 1439) throw new Error("Invalid war-room params");
  return runSource("orders", "war_room", [today, cutoffMinute], WarRoomRow);
}

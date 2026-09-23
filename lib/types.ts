// Shared types for the CTF Assistant.

export type Platform = "THM" | "HTB" | "lab";
export type GpuStatus = "starting" | "ready" | "stopping" | "stopped" | "n/a";
export type MessageRole = "user" | "vision" | "reason" | "system";

export interface SessionRow {
  id: number;
  user_id: number;
  room_name: string;
  platform: Platform;
  state_json: RoomState;
  gpu_status: GpuStatus;
  created_at: string;
  closed_at: string | null;
}

export interface MessageRow {
  id: number;
  session_id: number;
  role: MessageRole;
  content: string;
  created_at: string;
}

// Tracked state for a single CTF room. Extended as the room progresses.
export interface RoomState {
  target_ip?: string;
  open_ports?: string[];
  services?: string[];
  credentials?: string[];
  foothold?: string;
  notes?: string[];
}

export interface UsageTotals {
  vision_cost: number;
  reason_cost: number;
  gpu_cost: number;
  total_cost: number;
  tokens_in: number;
  tokens_out: number;
}

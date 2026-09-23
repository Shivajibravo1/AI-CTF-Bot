// GPU lifecycle. Only relevant when SELF-HOSTING the reasoning model on an
// on-demand GPU provider. When using a hosted reasoning API, GPU_PROVIDER is
// blank and these functions are no-ops (gpu_status = "n/a").
//
// This is intentionally provider-agnostic. Fill in the provider-specific calls
// for your chosen host (e.g. RunPod pod start/stop) in startPod / stopPod.

import type { GpuStatus } from "@/lib/types";

export function selfHosting(): boolean {
  return Boolean(process.env.GPU_PROVIDER && process.env.GPU_API_KEY && process.env.GPU_POD_ID);
}

export async function startPod(): Promise<GpuStatus> {
  if (!selfHosting()) return "n/a";
  try {
    // TODO (build time): call your GPU provider's "resume pod" API here.
    // Example shape (RunPod-style):
    //   await fetch(`${base}/pods/${process.env.GPU_POD_ID}/start`, {
    //     method: "POST",
    //     headers: { Authorization: `Bearer ${process.env.GPU_API_KEY}` },
    //   });
    console.log("[gpu] startPod requested for pod", process.env.GPU_POD_ID);
    return "starting";
  } catch (err) {
    console.error("[gpu] startPod failed", err);
    return "stopped";
  }
}

export async function stopPod(): Promise<GpuStatus> {
  if (!selfHosting()) return "n/a";
  try {
    // TODO (build time): call your GPU provider's "stop pod" API here.
    console.log("[gpu] stopPod requested for pod", process.env.GPU_POD_ID);
    return "stopped";
  } catch (err) {
    console.error("[gpu] stopPod failed", err);
    return "stopped";
  }
}

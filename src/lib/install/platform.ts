export type InstallPlatform = "ios" | "android" | "other";

export function installPlatform(userAgent: string, platform: string, touchPoints: number): InstallPlatform {
  if (/iPad|iPhone|iPod/i.test(userAgent) || (platform === "MacIntel" && touchPoints > 1)) return "ios";
  return /Android/i.test(userAgent) ? "android" : "other";
}

export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Prompts are single-use and only invoked by a deliberate button click.
export async function showInstallPrompt(event: InstallPromptEvent): Promise<"accepted" | "dismissed" | "unavailable"> {
  try {
    await event.prompt();
    return (await event.userChoice).outcome;
  } catch {
    return "unavailable";
  }
}

import { execFile as execFileCallback } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

export const execFile = promisify(execFileCallback);
const lookupCommand = process.platform === "win32" ? "where" : "which";

export async function commandExists(command: string) {
  if (command.includes("/") || command.includes("\\")) {
    try { await access(command); return true; } catch { return false; }
  }
  try { await execFile(lookupCommand, [command], { windowsHide: true, timeout: 15000 }); return true; } catch { return false; }
}

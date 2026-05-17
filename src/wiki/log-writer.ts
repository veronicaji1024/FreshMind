import { appendFile } from 'fs/promises';
import path from 'path';

export async function appendLog(
  vaultPath: string,
  action: string,
  page: string,
  summary: string,
): Promise<void> {
  const logPath = path.join(vaultPath, 'log.md');
  const now = new Date();
  const ts = now.toISOString().replace('T', ' ').slice(0, 16);
  const line = `- [${ts}] ${action}: ${page} — ${summary}\n`;
  await appendFile(logPath, line);
}

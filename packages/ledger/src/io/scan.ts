import { lstat, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface ScanClaudeTranscriptOptions {
  readonly transcriptsDir: string;
  readonly graceMs: number;
  readonly nowMs?: number;
}

export async function scanClaudeTranscriptFiles(options: ScanClaudeTranscriptOptions): Promise<string[]> {
  const projectsDir = join(options.transcriptsDir, 'projects');
  const nowMs = options.nowMs ?? Date.now();
  const files: string[] = [];

  let projectDirs;
  try {
    projectDirs = await readdir(projectsDir, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  for (const project of projectDirs) {
    if (!project.isDirectory()) continue;
    const dir = join(projectsDir, project.name);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const file = join(dir, entry.name);
      const linkStat = await lstat(file);
      if (linkStat.isSymbolicLink()) continue;
      const fileStat = await stat(file);
      if (!fileStat.isFile()) continue;
      if (nowMs - fileStat.mtimeMs < options.graceMs) continue;
      files.push(file);
    }
  }

  return files.sort();
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

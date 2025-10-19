import { promises as fs } from "fs";
import path from "path";

const baseDir = path.join(process.cwd(), ".next", "cache", "flightdata");

export async function readJson<T>(key: string, maxAgeMs: number): Promise<{ data: T | null; ts: number | null }> {
  try {
    const file = path.join(baseDir, `${key}.json`);
    const stat = await fs.stat(file).catch(() => null as any);
    if (!stat) return { data: null, ts: null };
    const ts = stat.mtimeMs;
    if (Date.now() - ts > maxAgeMs) return { data: null, ts };
    const buf = await fs.readFile(file, "utf8");
    return { data: JSON.parse(buf) as T, ts };
  } catch {
    return { data: null, ts: null };
  }
}

export async function writeJson<T>(key: string, data: T): Promise<void> {
  try {
    await fs.mkdir(baseDir, { recursive: true });
    const file = path.join(baseDir, `${key}.json`);
    await fs.writeFile(file, JSON.stringify(data), "utf8");
  } catch {
    // ignore
  }
}

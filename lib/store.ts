// Tiny JSON-file store. Good enough for a hackathon demo; swap for a DB in production.
import { promises as fs } from "fs";
import path from "path";
import type { Deal } from "./types";

const FILE = process.env.DEALS_FILE ?? path.join(process.cwd(), ".data", "deals.json");

async function readAll(): Promise<Record<string, Deal>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

// Serialize writes so concurrent requests can't clobber each other.
let queue: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export const getDeal = async (id: string) => (await readAll())[id] ?? null;
export const listDeals = async () => Object.values(await readAll());

export const saveDeal = (deal: Deal) =>
  locked(async () => {
    const all = await readAll();
    all[deal.id] = deal;
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(all, null, 2));
    return deal;
  });

/**
 * config.ts - persistent user configuration.
 *
 * Stored as JSON at ~/.agenttrail/config.json (override with the
 * AGENTTRAIL_CONFIG env var, used by tests). Only custom transcript roots
 * live here right now:
 *
 *   { "roots": [{ "path": "/abs/dir", "provider": "claude"|"codex"|"cursor"|"auto",
 *                 "label"?: "..." }] }
 *
 * A missing or corrupt config means "no extra roots", never a crash.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProviderName } from './types.js';

export interface CustomRoot {
  /** Absolute path of the transcript root. */
  path: string;
  /** Provider layout; 'auto' asks for layout sniffing at add time. */
  provider: ProviderName | 'auto';
  /** Optional display name for the UI. */
  label?: string;
}

export interface AgenttrailConfig {
  roots: CustomRoot[];
}

export function defaultConfigPath(): string {
  return process.env.AGENTTRAIL_CONFIG ?? path.join(os.homedir(), '.agenttrail', 'config.json');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const PROVIDERS = new Set(['claude', 'codex', 'cursor', 'auto']);

/** Read the config file. Any failure (missing, corrupt, wrong shape) → empty. */
export async function loadConfig(file = defaultConfigPath()): Promise<AgenttrailConfig> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(file, 'utf8');
  } catch {
    return { roots: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { roots: [] };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.roots)) return { roots: [] };
  const roots: CustomRoot[] = [];
  for (const r of parsed.roots) {
    if (!isRecord(r) || typeof r.path !== 'string' || !r.path) continue;
    roots.push({
      path: r.path,
      provider:
        typeof r.provider === 'string' && PROVIDERS.has(r.provider)
          ? (r.provider as CustomRoot['provider'])
          : 'auto',
      ...(typeof r.label === 'string' && r.label ? { label: r.label } : {}),
    });
  }
  return { roots };
}

/** Write the config file, creating the config dir on first save. */
export async function saveConfig(config: AgenttrailConfig, file = defaultConfigPath()): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

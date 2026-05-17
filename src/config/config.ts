import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import YAML from 'yaml';
import dotenv from 'dotenv';
import type { AppConfig } from '../types.js';
import { LLM_DEFAULTS, FRESHCHECK_DEFAULTS } from './defaults.js';

dotenv.config();

const DEFAULT_VAULT_PATH = './freshmind-wiki';
const CONFIG_FILENAME = '.freshmind.yaml';

/** 查找 .freshmind.yaml：先找当前目录，再找 vault 目录 */
function findConfigFile(vaultPath?: string): string | null {
  const candidates = [
    path.resolve(CONFIG_FILENAME),
    vaultPath ? path.resolve(vaultPath, CONFIG_FILENAME) : null,
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export async function loadConfig(vaultPathOverride?: string): Promise<AppConfig> {
  const configFile = findConfigFile(vaultPathOverride);

  let fileConfig: Partial<AppConfig> = {};
  if (configFile) {
    const raw = await readFile(configFile, 'utf-8');
    fileConfig = YAML.parse(raw) ?? {};
  }

  const vaultPath = vaultPathOverride
    ?? fileConfig.vault_path
    ?? DEFAULT_VAULT_PATH;

  return {
    vault_path: path.resolve(vaultPath),
    llm: {
      provider: fileConfig.llm?.provider ?? 'siliconflow',
      model: fileConfig.llm?.model ?? LLM_DEFAULTS.model,
      api_key: process.env.SILICONFLOW_API_KEY ?? fileConfig.llm?.api_key ?? '',
      base_url: fileConfig.llm?.base_url ?? LLM_DEFAULTS.baseUrl,
    },
    search: {
      provider: fileConfig.search?.provider ?? 'tavily',
      api_key: process.env.TAVILY_API_KEY ?? fileConfig.search?.api_key ?? '',
    },
    freshcheck: {
      max_items: fileConfig.freshcheck?.max_items ?? FRESHCHECK_DEFAULTS.maxItems,
      threshold: fileConfig.freshcheck?.threshold ?? FRESHCHECK_DEFAULTS.threshold,
    },
  };
}

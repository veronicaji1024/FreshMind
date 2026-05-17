import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import YAML from 'yaml';
import dotenv from 'dotenv';
import type { AppConfig, FreshMindConfig } from '../types.js';
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

/** Person A 使用的配置加载 */
export async function loadAppConfig(vaultPathOverride?: string): Promise<AppConfig> {
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

/** Person B 使用的简化配置加载 */
export async function loadConfig(vaultPath: string): Promise<FreshMindConfig> {
  dotenv.config();

  const config: FreshMindConfig = {
    vaultPath: path.resolve(vaultPath),
    siliconflowApiKey: process.env.SILICONFLOW_API_KEY,
    tavilyApiKey: process.env.TAVILY_API_KEY,
    llm: { ...LLM_DEFAULTS },
  };

  try {
    const yamlPath = path.join(vaultPath, '.freshmind.yaml');
    const content = await readFile(yamlPath, 'utf-8');
    const yamlConfig = YAML.parse(content);

    if (yamlConfig?.llm?.model) config.llm.model = yamlConfig.llm.model;
    if (yamlConfig?.llm?.base_url) config.llm.baseUrl = yamlConfig.llm.base_url;
    if (yamlConfig?.llm?.temperature) config.llm.temperature = yamlConfig.llm.temperature;
  } catch {
    // .freshmind.yaml 不存在则用默认值
  }

  return config;
}

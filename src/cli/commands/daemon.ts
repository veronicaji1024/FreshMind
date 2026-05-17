import { Command } from 'commander';
import { watch, type FSWatcher } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import matter from 'gray-matter';
import YAML from 'yaml';
import { ui } from '../ui.js';
import { loadAppConfig } from '../../config/config.js';
import { CrawlAgent } from '../../crawler/index.js';
import { CalibrationEngine } from '../../freshness/calibration.js';
import { rebuildIndex } from '../../wiki/index-manager.js';
import { appendLog } from '../../wiki/log-writer.js';
import type { WikiPageMeta, InfoType } from '../../types.js';

/**
 * fm daemon — 自进化长驻进程
 *
 * 架构借鉴 Hermes Agent：确定性外壳 + 非确定性内核
 *
 * 关键设计：不对单次编辑立即反应，而是：
 * 1. 积累用户编辑事件（确定性记录）
 * 2. 周期性分析 pattern（确定性统计 + 可选 LLM 辅助）
 * 3. 基于 pattern 批量校准（确定性公式）
 *
 * 这对应 Hermes 的"periodic evaluation"模式——
 * 不是每次操作都学，而是积累足够信号后批量分析。
 */

// ========== 事件记录层（确定性） ==========

interface EditEvent {
  timestamp: string;
  page_path: string;
  info_type: InfoType;
  previous_status: string;      // 修改前的 freshness_status
  claims_changed: boolean;      // verifiable_claims 是否有实质变化
  claims_added: number;         // 新增了几条 claims
  claims_removed: number;       // 删除了几条 claims
  claims_modified: number;      // 修改了几条 claims
  content_length_delta: number; // 正文长度变化
}

interface EventLog {
  events: EditEvent[];
  last_analysis: string | null;
}

// 内存中的页面快照
const pageSnapshots = new Map<string, {
  status: string;
  claims: string[];
  content_length: number;
}>();

/** 读取事件日志 */
async function readEventLog(vaultPath: string): Promise<EventLog> {
  const logPath = path.join(vaultPath, '_meta/edit_events.yaml');
  try {
    const raw = await readFile(logPath, 'utf-8');
    return YAML.parse(raw) ?? { events: [], last_analysis: null };
  } catch {
    return { events: [], last_analysis: null };
  }
}

/** 写入事件日志 */
async function writeEventLog(vaultPath: string, log: EventLog): Promise<void> {
  const logPath = path.join(vaultPath, '_meta/edit_events.yaml');
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, YAML.stringify(log));
}

/** 加载页面快照（daemon 启动时执行一次） */
async function loadSnapshots(vaultPath: string): Promise<void> {
  const { readAllPages } = await import('../../wiki/page-reader.js');
  const pages = await readAllPages(vaultPath);
  for (const page of pages) {
    const fullPath = path.join(vaultPath, page.path);
    pageSnapshots.set(fullPath, {
      status: page.meta.freshness_status ?? 'fresh',
      claims: (page.meta.verifiable_claims ?? []).map(c => c.claim),
      content_length: 0, // 启动时不读正文长度
    });
  }
}

/** 检测文件变更，记录事件（不立即校准） */
async function recordFileChange(
  filePath: string,
  vaultPath: string,
): Promise<void> {
  const relative = path.relative(vaultPath, filePath);
  if (
    relative.startsWith('_meta') || relative.startsWith('raw') ||
    relative === 'index.md' || relative === 'log.md' ||
    relative.includes('freshness-report') || !filePath.endsWith('.md')
  ) return;

  try {
    const content = await readFile(filePath, 'utf-8');
    const { data, content: body } = matter(content);
    const meta = data as WikiPageMeta;
    if (!meta.type) return;

    const snapshot = pageSnapshots.get(filePath);
    const newClaims = (meta.verifiable_claims ?? []).map(c => c.claim);
    const oldClaims = snapshot?.claims ?? [];

    // 计算 claims 变化细节
    const added = newClaims.filter(c => !oldClaims.includes(c));
    const removed = oldClaims.filter(c => !newClaims.includes(c));
    const claimsChanged = added.length > 0 || removed.length > 0;

    // 只记录有实质变化的编辑
    if (!claimsChanged && Math.abs(body.length - (snapshot?.content_length ?? 0)) < 50) {
      // 微小改动（<50字符），不记录
      pageSnapshots.set(filePath, { status: meta.freshness_status ?? 'fresh', claims: newClaims, content_length: body.length });
      return;
    }

    const event: EditEvent = {
      timestamp: new Date().toISOString(),
      page_path: relative,
      info_type: meta.type as InfoType,
      previous_status: snapshot?.status ?? 'fresh',
      claims_changed: claimsChanged,
      claims_added: added.length,
      claims_removed: removed.length,
      claims_modified: Math.min(added.length, removed.length), // 简单估算
      content_length_delta: body.length - (snapshot?.content_length ?? body.length),
    };

    // 追加到事件日志
    const log = await readEventLog(vaultPath);
    log.events.push(event);
    // 保留最近 200 条
    if (log.events.length > 200) {
      log.events = log.events.slice(-200);
    }
    await writeEventLog(vaultPath, log);

    // 更新快照
    pageSnapshots.set(filePath, { status: meta.freshness_status ?? 'fresh', claims: newClaims, content_length: body.length });

    ui.info(`📝 记录编辑事件: ${relative} (claims: +${added.length} -${removed.length})`);
  } catch {
    // 文件读取失败，静默跳过
  }
}

// ========== Pattern 分析层（周期性，确定性统计） ==========

interface PatternAnalysis {
  /** 按 InfoType 统计 claims 修改频率 */
  type_edit_frequency: Record<string, number>;
  /** 按 InfoType 统计"绿色页面被改 claims"的次数（漏报信号） */
  false_negative_count: Record<string, number>;
  /** 按 InfoType 统计"黄色页面 skip 后被改"的次数 */
  skip_then_edit_count: Record<string, number>;
  /** 总事件数 */
  total_events: number;
  /** 分析覆盖的时间范围 */
  period_days: number;
}

/** 分析积累的事件，提取 pattern */
function analyzePatterns(events: EditEvent[]): PatternAnalysis {
  const analysis: PatternAnalysis = {
    type_edit_frequency: {},
    false_negative_count: {},
    skip_then_edit_count: {},
    total_events: events.length,
    period_days: 0,
  };

  if (events.length === 0) return analysis;

  // 计算时间范围
  const first = new Date(events[0].timestamp);
  const last = new Date(events[events.length - 1].timestamp);
  analysis.period_days = Math.max(1, Math.round((last.getTime() - first.getTime()) / (24 * 60 * 60 * 1000)));

  for (const event of events) {
    if (!event.claims_changed) continue;

    const type = event.info_type;

    // 统计每种类型被编辑 claims 的次数
    analysis.type_edit_frequency[type] = (analysis.type_edit_frequency[type] ?? 0) + 1;

    // 🟢 fresh 页面的 claims 被改 → 漏报信号
    if (event.previous_status === 'fresh') {
      analysis.false_negative_count[type] = (analysis.false_negative_count[type] ?? 0) + 1;
    }

    // 🟡 stale 页面的 claims 被改 → skip_then_edit 信号
    if (event.previous_status === 'stale') {
      analysis.skip_then_edit_count[type] = (analysis.skip_then_edit_count[type] ?? 0) + 1;
    }
  }

  return analysis;
}

/**
 * 基于 pattern 分析结果执行校准（严格对齐 PRD 第九节）
 *
 * 不是单次触发，而是：
 * - 某类型积累了 3+ 次 false_negative → 才触发 manual_edit 校准
 * - 某类型积累了 2+ 次 skip_then_edit → 才触发校准
 * - 避免因单次偶然编辑导致半衰期大幅波动
 */
async function applyCalibration(
  analysis: PatternAnalysis,
  vaultPath: string,
  calibrationEngine: CalibrationEngine,
): Promise<void> {
  // 阈值：至少 3 次同类型的 false_negative 才校准
  const FALSE_NEGATIVE_THRESHOLD = 3;
  // 阈值：至少 2 次同类型的 skip_then_edit 才校准
  const SKIP_EDIT_THRESHOLD = 2;

  for (const [type, count] of Object.entries(analysis.false_negative_count)) {
    if (count >= FALSE_NEGATIVE_THRESHOLD) {
      await calibrationEngine.recordEvent({
        type: type as InfoType,
        action: 'manual_edit',
        page_path: `pattern_analysis (${count} false negatives)`,
        timestamp: new Date().toISOString(),
      });
      ui.warn(`📐 Pattern 校准: ${type} 半衰期 × 0.7 (${count} 次漏报)`);
      await appendLog(vaultPath, 'pattern_calibrate', type,
        `manual_edit: ${count} 次 fresh 页面被用户修改 claims → 半衰期过长`);
    }
  }

  for (const [type, count] of Object.entries(analysis.skip_then_edit_count)) {
    if (count >= SKIP_EDIT_THRESHOLD) {
      await calibrationEngine.recordEvent({
        type: type as InfoType,
        action: 'skip_then_edit',
        page_path: `pattern_analysis (${count} skip-then-edits)`,
        timestamp: new Date().toISOString(),
      });
      ui.warn(`📐 Pattern 校准: ${type} 半衰期 × 0.85 (${count} 次 skip 后编辑)`);
      await appendLog(vaultPath, 'pattern_calibrate', type,
        `skip_then_edit: ${count} 次 stale 页面被 skip 后用户手动更新`);
    }
  }
}

/** 周期性 pattern 分析（每次分析后清空已分析的事件） */
async function runPatternAnalysis(
  vaultPath: string,
  calibrationEngine: CalibrationEngine,
): Promise<void> {
  ui.info('🔍 开始 Pattern 分析...');

  const log = await readEventLog(vaultPath);
  if (log.events.length < 3) {
    ui.info('事件不足 3 条，跳过分析');
    return;
  }

  const analysis = analyzePatterns(log.events);

  ui.info(`  📊 统计: ${analysis.total_events} 条事件, ${analysis.period_days} 天`);
  for (const [type, count] of Object.entries(analysis.type_edit_frequency)) {
    ui.info(`    ${type}: ${count} 次 claims 编辑`);
  }

  await applyCalibration(analysis, vaultPath, calibrationEngine);

  // 清空已分析的事件，保留分析时间
  log.events = [];
  log.last_analysis = new Date().toISOString();
  await writeEventLog(vaultPath, log);

  await appendLog(vaultPath, 'pattern_analysis', 'daemon',
    `分析完成: ${analysis.total_events} 事件, ${Object.keys(analysis.type_edit_frequency).length} 类型有变化`);
}

// ========== Crawl + Freshcheck（与之前相同） ==========

async function runCrawl(vaultPath: string): Promise<void> {
  ui.info('⏰ 定时 crawl 开始...');
  try {
    const agent = new CrawlAgent(vaultPath);
    const result = await agent.crawl();

    await appendLog(vaultPath, 'daemon_crawl', 'all',
      `抓取完成: ${result.stats.new} 新, ${result.stats.skipped} 跳过`);

    if (result.new_items.length > 0) {
      ui.success(`发现 ${result.new_items.length} 篇新内容`);
      for (const item of result.new_items) {
        ui.info(`  📄 ${item.title}`);
      }

      // 有 API Key 时尝试自动 ingest（非确定性，失败不中断）
      if (process.env.SILICONFLOW_API_KEY) {
        try {
          const { LLMClient } = await import('../../agents/llm-client.js');
          const { PageWriter } = await import('../../wiki/page-writer.js');
          const { IngestAgent } = await import('../../agents/ingest-agent.js');

          const llm = new LLMClient();
          const pageWriter = new PageWriter(vaultPath);
          const ingestAgent = new IngestAgent(llm, pageWriter, vaultPath);

          for (const item of result.new_items.slice(0, 3)) {
            try {
              const ingestResult = await ingestAgent.ingest({ url: item.url });
              await appendLog(vaultPath, 'daemon_ingest', ingestResult.page_path,
                `自动 ingest: ${ingestResult.claims_count} 条声明`);
              ui.success(`  ✅ 已写入 ${ingestResult.page_path}`);
            } catch (err) {
              ui.warn(`  ⚠️ ingest 失败: ${(err as Error).message}`);
            }
          }
          await rebuildIndex(vaultPath);
        } catch (err) {
          ui.warn(`LLM ingest 降级: ${(err as Error).message}`);
        }
      }
    } else {
      ui.info('无新内容');
    }
  } catch (err) {
    ui.warn(`crawl 失败: ${(err as Error).message}`);
    await appendLog(vaultPath, 'daemon_error', 'crawl', (err as Error).message);
  }
}

async function runFreshcheck(vaultPath: string): Promise<void> {
  if (!process.env.SILICONFLOW_API_KEY || !process.env.TAVILY_API_KEY) {
    ui.info('⏰ 定时 freshcheck 跳过（缺少 API Key）');
    return;
  }

  ui.info('⏰ 定时 freshcheck 开始...');
  try {
    const { PageReader } = await import('../../wiki/page-reader.js');
    const { FreshnessScanner } = await import('../../freshness/scanner.js');
    const { LLMClient } = await import('../../agents/llm-client.js');
    const { TavilySearch } = await import('../../search/tavily.js');
    const { FreshnessAgent } = await import('../../agents/freshness-agent.js');
    const { ReportWriter } = await import('../../wiki/report-writer.js');

    const pageReader = new PageReader(vaultPath);
    const scanner = new FreshnessScanner(pageReader, vaultPath);
    const entries = await scanner.getCheckPriority(undefined, 10);

    if (entries.length === 0) {
      ui.info('所有知识都是新鲜的');
      return;
    }

    const llm = new LLMClient();
    const tavilySearch = new TavilySearch();
    const freshnessAgent = new FreshnessAgent(llm, tavilySearch);
    const results = await freshnessAgent.check(entries);

    const reportWriter = new ReportWriter(vaultPath);
    await reportWriter.writeReport(results);

    const stats = { contradicted: 0, updated: 0, confirmed: 0, uncertain: 0 };
    for (const r of results) {
      for (const v of r.verification) {
        stats[v.status]++;
      }
    }

    await appendLog(vaultPath, 'daemon_freshcheck', 'all',
      `检查完成: 🔴${stats.contradicted} 🟡${stats.updated} 🟢${stats.confirmed}`);
    ui.success(`freshcheck 完成: 🔴${stats.contradicted} 🟡${stats.updated} 🟢${stats.confirmed}`);
  } catch (err) {
    ui.warn(`freshcheck 失败: ${(err as Error).message}`);
    await appendLog(vaultPath, 'daemon_error', 'freshcheck', (err as Error).message);
  }
}

// ========== 入口 ==========

export function registerDaemon(program: Command) {
  program
    .command('daemon')
    .description('启动自进化后台进程（定时 crawl + freshcheck + 行为 pattern 学习）')
    .option('--vault <path>', 'vault 目录路径')
    .option('--crawl-interval <hours>', '抓取间隔（小时）', '6')
    .option('--freshcheck-interval <hours>', '保鲜检查间隔（小时）', '24')
    .option('--analysis-interval <hours>', 'Pattern 分析间隔（小时）', '168')
    .action(async (opts) => {
      const config = await loadAppConfig(opts.vault);
      const vaultPath = config.vault_path;
      const crawlMs = parseInt(opts.crawlInterval, 10) * 60 * 60 * 1000;
      const freshcheckMs = parseInt(opts.freshcheckInterval, 10) * 60 * 60 * 1000;
      const analysisMs = parseInt(opts.analysisInterval, 10) * 60 * 60 * 1000;

      const calibrationEngine = new CalibrationEngine(vaultPath);

      console.log();
      ui.success('FreshMind Daemon 已启动');
      ui.info(`  Vault: ${vaultPath}`);
      ui.info(`  Crawl 间隔: ${opts.crawlInterval}h`);
      ui.info(`  Freshcheck 间隔: ${opts.freshcheckInterval}h`);
      ui.info(`  Pattern 分析间隔: ${opts.analysisInterval}h`);
      ui.info(`  LLM: ${process.env.SILICONFLOW_API_KEY ? '✅' : '❌ 降级模式'}`);
      ui.info(`  Tavily: ${process.env.TAVILY_API_KEY ? '✅' : '❌ freshcheck 跳过'}`);
      console.log();

      // 1. 加载页面快照
      await loadSnapshots(vaultPath);
      ui.info(`📸 已加载 ${pageSnapshots.size} 个页面快照`);

      // 2. fs.watch 监听（只记录事件，不立即校准）
      const watchDirs = ['entities', 'concepts', 'models', 'comparisons', 'trends'];
      const watchers: FSWatcher[] = [];

      for (const dir of watchDirs) {
        const dirPath = path.join(vaultPath, dir);
        if (!existsSync(dirPath)) continue;
        try {
          const watcher = watch(dirPath, { recursive: true }, (_, filename) => {
            if (!filename?.endsWith('.md')) return;
            setTimeout(() => recordFileChange(path.join(dirPath, filename), vaultPath), 500);
          });
          watchers.push(watcher);
        } catch { /* 跳过 */ }
      }
      ui.info(`👁️ 监听 ${watchers.length} 个目录（事件积累模式）`);

      // 3. 启动时立即 crawl 一次
      await runCrawl(vaultPath);

      // 4. 定时任务
      const crawlTimer = setInterval(() => runCrawl(vaultPath), crawlMs);
      const freshcheckTimer = setInterval(() => runFreshcheck(vaultPath), freshcheckMs);
      const analysisTimer = setInterval(
        () => runPatternAnalysis(vaultPath, calibrationEngine),
        analysisMs,
      );

      // 5. 优雅退出
      const cleanup = () => {
        ui.info('\n正在关闭...');
        clearInterval(crawlTimer);
        clearInterval(freshcheckTimer);
        clearInterval(analysisTimer);
        for (const w of watchers) w.close();
        ui.success('Daemon 已停止');
        process.exit(0);
      };
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      await appendLog(vaultPath, 'daemon_start', 'daemon',
        `启动: crawl=${opts.crawlInterval}h, freshcheck=${opts.freshcheckInterval}h, analysis=${opts.analysisInterval}h`);

      ui.success('运行中... Ctrl+C 停止');
    });
}

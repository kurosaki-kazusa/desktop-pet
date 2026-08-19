// chat.js · 大模型会话后端（v2.3，主进程）
// 复刻 deepseek-harness 的会话设计要点（仅参考其文档与实现思路，未改动 deepseek-harness 任何代码）：
// 1. StreamChunk 流协议（docs/subsystems/llm-streaming.md）：
//    - reasoning（思考）与 text（正文）增量分离，思考内容不入历史
//    - usage 先于流结束、finish_reason 归一化
//    - 空回复（无任何内容块）判为 EMPTY_RESPONSE 可重试错误，而非静默成功
// 2. 适配器契约：
//    - 错误归一化为 { code, message, status }（对应 LlmFailure），消费方按码路由、不匹配 provider 文案
//    - CONTEXT_WINDOW_EXCEEDED 规范错误码（超窗自动裁剪历史重试）
//    - 超时看门狗（streamIdleTimeout）与用户中止（ABORTED）两种结局正交可辨
//    - 每次请求带 User-Agent 归属头（AppIdentity 思想）
// 3. 系统提示词分段组装（ContextForm 思想）：固定人设 + 动态上下文（当前时间 / 常用命令目录 catalog / 历史摘要）
// 4. 会话日志思想：历史只追加、稳定前缀（DeepSeek 上下文缓存友好），超限做摘要压缩（compaction 简化版）
// 5. 防御模式（docs/defensive-patterns.md）：所有失败统一从一个出口（onError）交付
// 本模块不依赖 electron，可用系统 node 直接单测（scripts/test-chat.js）

'use strict';

const fs = require('fs');
const path = require('path');

// ---------- .env 解析（不引第三方依赖） ----------
// 支持：注释（#）、KEY=VALUE、双/单引号包裹值；与 harness 环境变量命名对齐
function parseEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

function loadEnvFrom(dir) {
  if (!dir) return {};
  const p = path.join(dir, '.env');
  try {
    if (fs.existsSync(p)) return parseEnv(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    // .env 读取失败不致命：忽略即可
  }
  return {};
}

// ---------- 错误归一化（对应 harness LlmFailure） ----------
class LlmError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.status = status;
  }
}

// 上下文超限识别：仅匹配已知 provider 文案，命中后路由到 CONTEXT_WINDOW_EXCEEDED 规范码
function isContextOverflow(message) {
  const m = (message || '').toLowerCase();
  return m.includes('context length') || m.includes('maximum context') || m.includes('context window');
}

// ---------- 系统提示词组装（harness ContextForm：固定人设 + 动态上下文） ----------
const DEFAULT_PERSONA = `你是一只名叫「咪咪」的桌面宠物猫，生活在用户的电脑桌面上，是用户的贴心小伙伴。

【对话风格】
- 语气亲切温暖、活泼自然，可以偶尔卖萌（比如句尾加个"喵~"）
- 回复简洁：一般 1~3 句话，除非用户追问细节
- 用户用中文时用中文，用户用英文时用英文

【时间感知】
- 根据当前时间自然关心用户：深夜提醒早睡、饭点关心吃饭、工作时间少打扰、休息时间多陪伴

【记忆与陪伴】
- 记住用户在对话中透露的偏好和重要事情，在合适的时候自然提起
- 用户倾诉情绪时先共情，再回应`;

function formatTime(now) {
  const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${week} ${p(now.getHours())}:${p(now.getMinutes())}`;
}

// 分段组装：人设（默认或自定义）→ 当前时间 → 常用命令目录（catalog）→ 历史摘要
function buildSystemPrompt({ persona, catalog, summary, now }) {
  const sections = [persona && persona.trim() ? persona.trim() : DEFAULT_PERSONA];
  sections.push(`【当前时间】\n${formatTime(now || new Date())}`);
  if (catalog && catalog.length) {
    const items = catalog.slice(0, 10).map((t) => `- ${t}`).join('\n');
    sections.push(`【用户的常用命令目录】\n聊天中提到"执行/查询/清理/打开"等操作时，可以自然地推荐其中的命令：\n${items}`);
  }
  if (summary && summary.trim()) {
    sections.push(`【更早对话的记忆摘要】\n${summary.trim()}`);
  }
  return sections.join('\n\n');
}

// ---------- 流式调用（复刻 StreamChunk：reasoning/text 分离、usage 先于结束、空回复=错误） ----------
async function streamCompletion({
  apiKey,
  baseUrl,
  model,
  messages,
  signal,
  idleTimeoutMs = 60000, // 看门狗：流内无新数据超过该时长判 TIMEOUT
  onText = () => {},
  onThinking = () => {},
  onUsage = () => {},
  fetchImpl,
}) {
  const f = fetchImpl || fetch;
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;

  // 内部控制器中转：用户中止（signal）与看门狗超时（idleFired）两种结局正交可辨
  const relay = new AbortController();
  let idleFired = false;
  let idleTimer = null;
  const onUserAbort = () => relay.abort();
  const armWatchdog = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { idleFired = true; relay.abort(); }, idleTimeoutMs);
  };
  if (signal) signal.addEventListener('abort', onUserAbort);

  try {
    let resp;
    try {
      resp = await f(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          // 归属头（harness AppIdentity）：只含公开产品事实，绝无密钥/路径/会话信息
          'User-Agent': 'ai-desktop-pet/1.1.0 (+https://github.com/kurosaki-kazusa/desktop-pet)',
        },
        body: JSON.stringify({ model, messages, stream: true }),
        signal: relay.signal,
      });
    } catch (err) {
      if (signal && signal.aborted) throw new LlmError('ABORTED', '请求已中止');
      if (idleFired) throw new LlmError('TIMEOUT', `请求超过 ${Math.round(idleTimeoutMs / 1000)} 秒无响应`);
      throw new LlmError('NETWORK', `网络请求失败：${err.message}`);
    }

    if (!resp.ok) {
      let detail = '';
      try {
        const raw = await resp.text();
        try { detail = JSON.parse(raw).error?.message || raw; } catch (e) { detail = raw; }
      } catch (e) { /* 忽略读取失败 */ }
      if (isContextOverflow(detail)) {
        throw new LlmError('CONTEXT_WINDOW_EXCEEDED', detail || '上下文超出窗口限制', resp.status);
      }
      throw new LlmError(`HTTP_${resp.status}`, detail || `服务返回 ${resp.status}`, resp.status);
    }

    // SSE 解析：逐行取 data: 载荷，[DONE] 终止；reasoning_content 与 content 分离
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let text = '';
    let thinking = '';
    let finishReason = null;
    let usage = null;
    let done = false;

    while (!done) {
      armWatchdog();
      let chunk;
      try {
        const r = await reader.read();
        if (r.done) break;
        chunk = r.value;
      } catch (err) {
        if (signal && signal.aborted) throw new LlmError('ABORTED', '请求已中止');
        if (idleFired) throw new LlmError('TIMEOUT', `流式响应中断超过 ${Math.round(idleTimeoutMs / 1000)} 秒`);
        throw new LlmError('NETWORK', `流式读取失败：${err.message}`);
      }
      clearTimeout(idleTimer);
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') { done = true; break; }
        let data;
        try { data = JSON.parse(payload); } catch (e) { continue; } // 半行/脏数据跳过
        if (data.usage) { usage = data.usage; onUsage(data.usage); }
        for (const c of data.choices || []) {
          const d = c.delta || {};
          if (d.reasoning_content) { thinking += d.reasoning_content; onThinking(d.reasoning_content); }
          if (d.content) { text += d.content; onText(d.content); }
          if (c.finish_reason) finishReason = c.finish_reason;
        }
      }
    }

    // 空回复 = 可重试错误（harness EMPTY_RESPONSE），而非静默成功
    if (!text && !thinking) throw new LlmError('EMPTY_RESPONSE', '模型返回了空回复');

    return { text, thinking, finishReason, usage };
  } finally {
    clearTimeout(idleTimer);
    if (signal) signal.removeEventListener('abort', onUserAbort);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 会话引擎：单实例单飞、历史/摘要/重试/压缩 ----------
class ChatEngine {
  constructor({ getConfig, getCatalog, loadHistory, saveHistory, loadSummary, saveSummary, fetchImpl }) {
    this.opts = { getConfig, getCatalog, loadHistory, saveHistory, loadSummary, saveSummary, fetchImpl };
    this.busy = false;
    this.abortController = null;
    this.history = []; // 结构对齐 harness Message：{ role: 'user'|'assistant', content }，只追加不重写
    this.summary = ''; // 被裁剪历史的摘要（compaction 简化版）
  }

  // 配置优先级：配置中心「大模型」页签（electron-store）> .env > 内置默认
  resolveConfig() {
    const { settings = {}, env = {} } = this.opts.getConfig ? this.opts.getConfig() : {};
    const pick = (v) => (v === undefined || v === null ? '' : String(v).trim());
    return {
      apiKey: pick(settings.apiKey) || pick(env.DEEPSEEK_API_KEY),
      baseUrl: pick(settings.baseUrl) || pick(env.DEEPSEEK_BASE_URL) || 'https://api.deepseek.com',
      model: pick(settings.model) || pick(env.DEEPSEEK_MODEL) || 'deepseek-chat',
      systemPrompt: pick(settings.systemPrompt),
      maxTurns: Number(settings.maxTurns) || Number(env.CHAT_MAX_TURNS) || 12,
    };
  }

  // 稳定前缀：system → 历史（追加序）→ 新用户消息。DeepSeek 上下文缓存按前缀命中，
  // 因此历史只追加、旧轮永不重写（harness 会话日志同款设计）
  buildMessages(cfg, userText) {
    const system = buildSystemPrompt({
      persona: cfg.systemPrompt,
      catalog: this.opts.getCatalog ? this.opts.getCatalog() : [],
      summary: this.summary,
    });
    return [{ role: 'system', content: system }, ...this.history, { role: 'user', content: userText }];
  }

  send(text, { onChunk, onDone, onError } = {}) {
    if (this.busy) return false;
    const userText = String(text).trim().slice(0, 500);
    if (!userText) return false;
    this.busy = true;
    this.abortController = new AbortController();
    this._run(userText, { onChunk, onDone, onError });
    return true;
  }

  abort() {
    if (this.abortController) this.abortController.abort();
  }

  clearHistory() {
    this.history = [];
    this.summary = '';
    if (this.opts.saveHistory) this.opts.saveHistory([]);
    if (this.opts.saveSummary) this.opts.saveSummary('');
  }

  async _run(userText, cb) {
    const cfg = this.resolveConfig();
    try {
      if (!cfg.apiKey) {
        throw new LlmError('NO_API_KEY', '未配置 API Key（.env 的 DEEPSEEK_API_KEY 或配置中心「大模型」页签）');
      }
      this.history = (this.opts.loadHistory && this.opts.loadHistory()) || [];
      this.summary = (this.opts.loadSummary && this.opts.loadSummary()) || '';

      let text = '';
      let thinking = '';
      // 单轮最多两次尝试（harness：适配器调用即一次 provider 尝试，此处为轻量重试策略）
      for (let attempt = 1; attempt <= 2; attempt++) {
        const emittedAny = Boolean(text || thinking);
        const messages = this.buildMessages(cfg, userText);
        try {
          const result = await streamCompletion({
            apiKey: cfg.apiKey,
            baseUrl: cfg.baseUrl,
            model: cfg.model,
            messages,
            signal: this.abortController.signal,
            onText: (d) => { text += d; cb.onChunk && cb.onChunk({ delta: d, kind: 'text' }); },
            onThinking: (d) => { thinking += d; cb.onChunk && cb.onChunk({ delta: d, kind: 'thinking' }); },
            fetchImpl: this.opts.fetchImpl,
          });
          // 成功落盘：思考内容不入历史（对应 harness ReasoningBlock 与可见文本分离）
          this.history.push({ role: 'user', content: userText }, { role: 'assistant', content: text });
          await this.compact(cfg);
          if (this.opts.saveHistory) this.opts.saveHistory(this.history);
          if (this.opts.saveSummary) this.opts.saveSummary(this.summary);
          cb.onDone && cb.onDone({ text });
          return;
        } catch (err) {
          // 超窗：规范错误码路由——裁剪最旧 1/3 历史（整轮裁剪）后重试
          if (err.code === 'CONTEXT_WINDOW_EXCEEDED' && attempt === 1) {
            const dropTurns = Math.max(1, Math.ceil(this.history.length / 6));
            this.history = this.history.slice(dropTurns * 2);
            continue;
          }
          // 其他重试仅在"尚无内容流出"时进行（避免已显示文本重复拼接）
          const retryable = !emittedAny && attempt === 1 && (
            err.code === 'NETWORK' || err.code === 'TIMEOUT' ||
            err.code === 'EMPTY_RESPONSE' || /^HTTP_5\d\d$/.test(err.code)
          );
          if (retryable) {
            await sleep(500);
            continue;
          }
          throw err;
        }
      }
      throw new LlmError('RETRY_EXHAUSTED', '多次尝试后仍未能获得回复');
    } catch (err) {
      // 统一出口（防御模式）：所有失败归一为 { code, message } 交付渲染层
      cb.onError && cb.onError({ code: err.code || 'UNKNOWN', message: err.message || String(err) });
    } finally {
      this.busy = false;
      this.abortController = null;
    }
  }

  // 上下文压缩（compaction 简化版）：超出 maxTurns 轮 → 最旧轮摘出做摘要，摘要失败仅丢弃
  async compact(cfg) {
    const maxMsgs = cfg.maxTurns * 2;
    if (this.history.length <= maxMsgs) return;
    const overflow = this.history.splice(0, this.history.length - maxMsgs);
    if (overflow.length % 2 === 1) overflow.shift(); // 只摘完整轮
    if (!overflow.length) return;
    const transcript = overflow
      .map((m) => `${m.role === 'user' ? '用户' : '桌宠'}：${m.content}`)
      .join('\n');
    try {
      const result = await streamCompletion({
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        messages: [{
          role: 'user',
          content: `请把下面这段对话历史压缩成一段不超过 200 字的中文摘要，保留：用户偏好、重要事件、未完成事项。只输出摘要本身。\n\n${this.summary ? `【已有摘要】\n${this.summary}\n\n` : ''}【新增历史】\n${transcript}`,
        }],
        idleTimeoutMs: 30000,
        fetchImpl: this.opts.fetchImpl,
      });
      if (result.text.trim()) this.summary = result.text.trim();
    } catch (e) {
      // 摘要失败不致命：旧历史直接丢弃（已有摘要保留）
    }
  }
}

module.exports = {
  ChatEngine,
  streamCompletion,
  buildSystemPrompt,
  parseEnv,
  loadEnvFrom,
  LlmError,
  DEFAULT_PERSONA,
};

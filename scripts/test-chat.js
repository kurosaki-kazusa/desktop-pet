// scripts/test-chat.js · chat.js 纯逻辑自测（不依赖 electron，可用系统 node 直接跑）
// 用法：npm run test:chat  或  node scripts/test-chat.js
// 覆盖：SSE 流解析（reasoning/text 分离、usage、[DONE]）、空回复/超窗错误归一化、
//       系统提示词分段组装、.env 解析、引擎级重试与历史落盘

'use strict';

const assert = require('assert');
const {
  ChatEngine,
  streamCompletion,
  buildSystemPrompt,
  parseEnv,
  LlmError,
} = require('../chat');

let passed = 0;
function ok(name) {
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// 构造 SSE 响应（ReadableStream 模拟 fetch response.body）
function sseResponse(lines, status = 200, errorMessage = '') {
  if (status !== 200) {
    return {
      ok: false,
      status,
      text: async () => JSON.stringify({ error: { message: errorMessage } }),
    };
  }
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const l of lines) controller.enqueue(enc.encode(l));
      controller.close();
    },
  });
  return { ok: true, status, body: stream };
}

async function main() {
  // ---------- 1. SSE 解析：正文/思考分离 + usage + 终止 ----------
  {
    const texts = [];
    const thinks = [];
    let usage = null;
    const result = await streamCompletion({
      apiKey: 'sk-test',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-reasoner',
      messages: [{ role: 'user', content: 'hi' }],
      onText: (d) => texts.push(d),
      onThinking: (d) => thinks.push(d),
      onUsage: (u) => { usage = u; },
      fetchImpl: async () => sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"让我想想"}}]}\n',
        'data: {"choices":[{"delta":{"content":"你好"}}]}\n',
        'data: {"choices":[{"delta":{"content":"！"},"finish_reason":"stop"}]}\n',
        'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n',
        'data: [DONE]\n',
      ]),
    });
    assert.strictEqual(texts.join(''), '你好！');
    assert.strictEqual(thinks.join(''), '让我想想');
    assert.strictEqual(usage.completion_tokens, 5);
    assert.strictEqual(result.text, '你好！');
    assert.strictEqual(result.thinking, '让我想想');
    ok('SSE 解析：正文/思考分离、usage、[DONE] 终止');
  }

  // ---------- 2. 空回复 → EMPTY_RESPONSE ----------
  {
    let caught = null;
    try {
      await streamCompletion({
        apiKey: 'sk-test', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'hi' }],
        fetchImpl: async () => sseResponse([
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n',
          'data: [DONE]\n',
        ]),
      });
    } catch (e) { caught = e; }
    assert.ok(caught instanceof LlmError);
    assert.strictEqual(caught.code, 'EMPTY_RESPONSE');
    ok('空回复归一为 EMPTY_RESPONSE 错误');
  }

  // ---------- 3. 超窗文案 → CONTEXT_WINDOW_EXCEEDED ----------
  {
    let caught = null;
    try {
      await streamCompletion({
        apiKey: 'sk-test', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'hi' }],
        fetchImpl: async () => sseResponse(
          [], 400,
          "This model's maximum context length is 65536 tokens"
        ),
      });
    } catch (e) { caught = e; }
    assert.strictEqual(caught.code, 'CONTEXT_WINDOW_EXCEEDED');
    assert.strictEqual(caught.status, 400);
    ok('超窗文案归一为 CONTEXT_WINDOW_EXCEEDED（按码路由）');
  }

  // ---------- 4. 系统提示词分段组装 ----------
  {
    const t = buildSystemPrompt({
      persona: '自定义人设',
      catalog: ['清缓存', '关机'],
      summary: '用户喜欢猫',
      now: new Date(2026, 7, 19, 14, 30),
    });
    assert.ok(t.includes('自定义人设'));
    assert.ok(t.includes('2026年8月19日 星期'));
    assert.ok(t.includes('常用命令目录'));
    assert.ok(t.includes('- 清缓存'));
    assert.ok(t.includes('更早对话的记忆摘要'));
    const t2 = buildSystemPrompt({ persona: '', catalog: [], summary: '', now: new Date() });
    assert.ok(!t2.includes('常用命令目录'));
    assert.ok(t2.includes('咪咪'));
    ok('提示词分段组装：人设/时间/命令目录/摘要（空目录省略节）');
  }

  // ---------- 5. .env 解析 ----------
  {
    const env = parseEnv('# 注释\nDEEPSEEK_API_KEY=sk-abc\nBASE_URL="https://x.com"\nMODEL=\'deepseek-chat\'\nBAD_LINE');
    assert.strictEqual(env.DEEPSEEK_API_KEY, 'sk-abc');
    assert.strictEqual(env.BASE_URL, 'https://x.com');
    assert.strictEqual(env.MODEL, 'deepseek-chat');
    assert.strictEqual(env.BAD_LINE, undefined);
    ok('.env 解析：注释/引号/坏行');
  }

  // ---------- 6. 引擎级：空回复重试一次成功 + 历史落盘 ----------
  {
    let call = 0;
    let savedHistory = null;
    const engine = new ChatEngine({
      getConfig: () => ({ settings: {}, env: { DEEPSEEK_API_KEY: 'sk-test' } }),
      getCatalog: () => ['清缓存'],
      loadHistory: () => [],
      saveHistory: (h) => { savedHistory = h; },
      loadSummary: () => '',
      saveSummary: () => {},
      fetchImpl: async () => {
        call += 1;
        if (call === 1) {
          return sseResponse([
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n',
            'data: [DONE]\n',
          ]);
        }
        return sseResponse([
          'data: {"choices":[{"delta":{"content":"重试成功"}}]}\n',
          'data: [DONE]\n',
        ]);
      },
    });
    const events = { chunks: [], done: 0, errors: [] };
    const accepted = engine.send('你好', {
      onChunk: (d) => events.chunks.push(d),
      onDone: () => { events.done += 1; },
      onError: (e) => events.errors.push(e),
    });
    assert.strictEqual(accepted, true);
    while (engine.busy) await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(call, 2, '空回复应触发一次重试');
    assert.strictEqual(events.done, 1);
    assert.strictEqual(events.errors.length, 0);
    assert.strictEqual(events.chunks.map((c) => c.delta).join(''), '重试成功');
    assert.strictEqual(savedHistory.length, 2);
    assert.deepStrictEqual(savedHistory[0], { role: 'user', content: '你好' });
    assert.strictEqual(savedHistory[1].role, 'assistant');
    ok('引擎级：EMPTY_RESPONSE 重试一次成功 + 历史落盘（思考不入历史）');
  }

  // ---------- 7. 引擎级：无 Key → NO_API_KEY 统一出口 ----------
  {
    const engine = new ChatEngine({
      getConfig: () => ({ settings: {}, env: {} }),
      loadHistory: () => [],
      saveHistory: () => {},
      loadSummary: () => '',
      saveSummary: () => {},
    });
    const errors = [];
    engine.send('hi', { onError: (e) => errors.push(e) });
    while (engine.busy) await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(errors[0].code, 'NO_API_KEY');
    ok('引擎级：无 Key 归一为 NO_API_KEY');
  }

  console.log(`\n全部通过：${passed} 项`);
  process.exit(0);
}

main().catch((e) => {
  console.error('\n测试失败：', e);
  process.exit(1);
});

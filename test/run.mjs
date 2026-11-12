/**
 * 本机冒烟测试：模拟 ctx.tools.register，再真实调用两个工具。
 *   node test/run.mjs
 *   node test/run.mjs --debate   # 额外跑一次完整辩论（10 次 LLM 调用）
 */
import { apply } from '../lib/index.js';

const registered = [];
const ctx = {
  tools: { register: (def) => registered.push(def) },
  logger: { info: (m) => console.log('[ctx]', m) }
};

apply(ctx);
console.log('已注册：', registered.map((d) => d.name).join(', '));
for (const t of registered) {
  if (!t.output || typeof t.output.render !== 'function') throw new Error(`${t.name} 缺少 output.render`);
  if (!t.parameters || t.parameters.type !== 'object') throw new Error(`${t.name} 参数不是 object schema`);
}

const sentiment = registered.find((t) => t.name === 'news_sentiment');
const r1 = await sentiment.execute({
  texts: ['宁德时代三季报净利大增，拟 400 亿回购。公司称产能利用率维持高位。',
          '某公司因信息披露违规被立案调查，股价跌停。交易所下发关注函。']
});
console.log('打分：', JSON.stringify(r1.items.map((i) => [i.label_name, i.score, i.confidence])));

if (process.argv.includes('--debate')) {
  const debate = registered.find((t) => t.name === 'stock_debate');
  const r2 = await debate.execute({ symbol: '600519.SH' });
  console.log('辩论：', r2.rating, r2.verdict, r2.position_pct + '%');
  console.log('摘要：', r2.judge.executive_summary);
}

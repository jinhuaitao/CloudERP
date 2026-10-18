// 自动创建 R2 存储桶（供 deploy:ci / Workers Builds 的 Deploy command 调用）
// 需要环境变量：CLOUDFLARE_API_TOKEN（需 R2 写权限）、CLOUDFLARE_ACCOUNT_ID
// 若未配置则跳过并给出提示（此时请在 Cloudflare 控制台 R2 页面手动建桶）

const BUCKET = process.env.R2_BUCKET || "jinxiao-files";
const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

if (!token || !accountId) {
  console.log("ℹ️  未配置 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID，跳过 R2 自动创建。");
  console.log("   请确保 R2 中已存在存储桶 jinxiao-files，或在构建环境变量中配置上述两项。");
  process.exit(0);
}

const api = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const list = await fetch(api, { headers });
if (!list.ok) {
  console.error("❌ 查询 R2 存储桶失败：", list.status, await list.text());
  process.exit(1);
}
const { result = [] } = await list.json();
if (result.some((b) => b.name === BUCKET)) {
  console.log(`✅ R2 存储桶已存在：${BUCKET}`);
  process.exit(0);
}

console.log(`🔨 R2 存储桶不存在，正在创建：${BUCKET} ...`);
const create = await fetch(api, { method: "POST", headers, body: JSON.stringify({ name: BUCKET }) });
if (!create.ok) {
  console.error("❌ 创建 R2 存储桶失败：", create.status, await create.text());
  process.exit(1);
}
console.log(`✅ R2 存储桶创建成功：${BUCKET}`);

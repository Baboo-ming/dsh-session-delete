// 给 GitHub 仓库设置 topics（PUT 会整体替换现有 topics）
// 用法（PowerShell）：
//   $env:GH_TOKEN='<PAT>'; node set-topic.mjs
//   $env:GH_TOKEN='<PAT>'; node set-topic.mjs Baboo-ming/dsh-session-delete dsh-plugin dsh deepseek-harness
// 需要的权限：classic PAT 勾 public_repo（公开仓库）即可；细粒度 PAT 需该仓库的 Administration/Metadata 写权限。

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.error('缺少 GH_TOKEN 环境变量');
  process.exit(2);
}

const repo = process.argv[2] || 'Baboo-ming/dsh-session-delete';
const topics = process.argv.length > 3 ? process.argv.slice(3) : ['dsh-plugin'];

const res = await fetch(`https://api.github.com/repos/${repo}/topics`, {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'dsh-topic-setter',
  },
  body: JSON.stringify({ names: topics }),
  signal: AbortSignal.timeout(30000),
});

const text = await res.text();
console.log('HTTP', res.status);
if (!res.ok) {
  console.error(text);
  process.exit(1);
}
console.log('topics now:', (JSON.parse(text).names || []).join(', '));

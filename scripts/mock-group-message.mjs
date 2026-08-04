// ===== 本地模拟群消息 =====
// 方案 §9.2。只在 AUTH_MODE=mock 且 NODE_ENV!=production 时可用。
//
// 它调的是 napcat.ts 里那个 handleGroupMessage() —— 和 NapCat 真消息完全同一个入口。
// 所以本地测试照样覆盖 QQ 匹配、授权群校验、状态转换、两码上限和累计发码统计。
// 绝对不要改成"直接 UPDATE 成 active"：那样测的就不是这套业务了。
//
// 用法：
//   npm run mock:group-message -- --qq 123456789 --group 123456789 --message "/SIGNUP QwQ-7K3M9P"

// 这个脚本 import 的是未编译的 .ts，所以要用 tsx 跑（见 package.json 的 mock:group-message）
function arg(name) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const qq = arg('qq')
const group = arg('group')
const message = arg('message')

if (!qq || !group || !message) {
  console.error('用法: --qq <QQ号> --group <群号> --message "/SIGNUP QwQ-XXXXXX"')
  process.exit(1)
}

const { config } = await import('../server/src/config.ts')

// 双保险：config.ts 已经在生产拒绝 mock 模式，这里再挡一次
if (config.isProd || config.authMode !== 'mock') {
  console.error('只能在 NODE_ENV!=production 且 AUTH_MODE=mock 下运行')
  process.exit(1)
}

const { handleGroupMessage } = await import('../server/src/napcat.ts')
const { pool } = await import('../server/src/db.ts')

await handleGroupMessage({
  groupId: String(group),
  userId: String(qq),
  text: String(message),
  nickname: 'mock-user',
  role: 'member'
})

// 只回报"消息已投递"。激活成功与否要去页面或数据库看 —— 这个脚本不该替业务下结论
console.log('已按群消息投递:', { group, qq, message })
await pool.end()

# AI Industry Map 主理人使用指南

这份指南写给网站主理人（不需要会写代码）。所有技术性的事情都可以直接交给 Claude，你只需要在网页上写、在 GitHub 上点几下。

---

## 一、整体是怎么运作的

- **公开仓库** `oscarzhang-research/AI-Industry-Map`：网站代码、五层框架、公司库、每日行情、公开研报、你选择公开的观点。任何人都能看。
- **私有仓库** `oscarzhang-research/AI-Industry-Map-private`：你的私有观点和笔记、卖方研报 PDF、私有报告。只有你能看。
- **网站**：GitHub Pages 免费托管，地址将是 `https://oscarzhang-research.github.io/AI-Industry-Map/`（正式上线后生效）。
- **行情**：每个交易日亚洲收盘后、美股收盘后自动更新（GitHub Actions 自动运行，不需要你做任何事）。
- **你写东西**：在网站上登录后直接写，点保存即可。私有内容只进私有仓库；公开内容会自动生成一份“脱敏副本”放进公开仓库。

---

## 二、一次性设置（约 15 分钟）

### 第 1 步：创建私有仓库

1. 打开 github.com，右上角点 **+** → **New repository**。
2. Owner 选 `oscarzhang-research`，Repository name 填 **`AI-Industry-Map-private`**（必须一字不差）。
3. 选择 **Private**（非常重要）。
4. 勾选 **Add a README file**。
5. 点 **Create repository**。

### 第 2 步：让 Claude 能访问这个私有仓库

Claude 需要通过 “Claude GitHub App” 访问仓库，才能帮你把卖方 PDF 等私有材料放进去、翻译你的笔记。

1. 打开 https://github.com/apps/claude/installations/select_target ，选择你的账号 `oscarzhang-research`。
2. 在 **Repository access** 里，如果是 “Only select repositories”，把 **AI-Industry-Map-private** 加进去（公开仓库 AI-Industry-Map 也要在列表里），点 **Save**。
3. 回到和 Claude 的对话，告诉 Claude：“私有仓库建好了”。Claude 会把已经整理好的卖方研报和私有报告放进去。

### 第 3 步：开启网站（GitHub Pages）

1. 打开公开仓库 `AI-Industry-Map` → **Settings** → 左栏 **Pages**。
2. **Build and deployment** → **Source** 选择 **GitHub Actions**。
3. 告诉 Claude：“合并到 main 并上线”。Claude 会把实验版本合并进主分支，网站约 3 分钟后可以访问。

### 第 4 步：生成网站登录用的 Token（钥匙）

网站没有账号密码系统，你用一把只对这两个仓库有效的 GitHub “钥匙”登录。

1. github.com → 右上角头像 → **Settings** → 左栏最下面 **Developer settings**。
2. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**。
3. 填写：
   - **Token name**：`AI Industry Map`
   - **Expiration**：建议选 1 年（到期后按同样步骤再生成一把）
   - **Resource owner**：`oscarzhang-research`
   - **Repository access**：选 **Only select repositories**，勾选 `AI-Industry-Map` 和 `AI-Industry-Map-private` 两个
   - **Permissions → Repository permissions**：
     - **Contents**：**Read and write**（必需）
     - **Actions**：**Read and write**（可选，用于在网站上点“立即刷新行情”）
     - Metadata 会自动设为 Read-only，不用管
4. 点 **Generate token**，复制以 `github_pat_` 开头的那一串。**它只显示一次**，建议存进密码管理器。

### 第 5 步：在网站上登录

1. 打开网站，点页脚的 **Settings & owner sign-in**（或手机上右上角菜单 → Settings）。
2. 在 **Owner sign-in** 粘贴 token，点 **Sign in**。
3. 看到 “Signed in as oscarzhang-research” 和 “Vault loaded” 就成功了。右上角会出现 **New view** 按钮和 “Owner” 标记。

每台设备（电脑、手机）各登录一次即可。在别人的电脑上用完记得点 **Sign out**。

> 还没登录也可以先体验：Settings → **Start demo mode**，写的东西只存在当前浏览器，不会上传。

---

## 三、日常使用

### 早上：看新闻、记笔记

- 首页下方和 **News** 页面按五层列出最新的重要新闻（带圆点的是重点）。**Brief** 区块是每层最近十天最重要的三条。
- 看到值得记的，点 **Save as note**：自动带上标题、摘要、来源链接和相关公司，你在 “My take” 后面写自己的看法即可（中文没问题）。
- 随手记：右下角 **Quick note**。

### 写观点（核心功能）

点右上角 **New view**。上面是结构化字段，下面全是可选的自由文本，两者结合：

| 网站上的字段 | 含义 |
| --- | --- |
| About | 观点对象：一家公司 / 一个行业或层 / 一个主题 |
| Direction | 看多 Long、看空 Short、观察 Watching、中性 Neutral |
| Conviction | 信心 1–5 |
| One-line conclusion | 一句话结论（会显示在卡片和地图上） |
| Base price | 基准价：默认是写观点时的最新收盘价，可以改；点 “use it” 一键填入 |
| Target / Stop | 目标价 / 止损价（可选） |
| Horizon | 持有期限（月数，或截止日期） |
| Scenarios | 牛市 / 基准 / 熊市情景价格和概率，网站自动算加权回报 |
| Core logic | 核心逻辑与产业最新动态 |
| Variant perception / Consensus | 你和市场共识的不同之处 / 市场共识 |
| Bear case | 最强的反方论点 |
| Valuation | 估值 |
| Validation signals | 关键数据与验证信号（可设检查日期和状态：待定 / 已验证 / 部分 / 已证伪） |
| Risks and falsification | 风险与证伪条件（写清楚“出现什么就说明我错了”） |
| Catalysts | 催化剂（带日期的会出现在 Calendar 日历里） |
| Industry updates | 跟踪更新（也可以在观点页面底部直接加） |
| Related tickers | 相关标的：同样受益、受损、对冲、同行、供应商、客户 |
| Research behind this view | 引用的研报 |
| Plan / Position | 交易计划 / 仓位（默认不公开） |
| Free-form notes | 任何不适合放在上面的内容 |
| Visibility | 私有（默认）或公开 |

保存后，观点页面会显示：自写观点以来的收益、相对基准指数的超额收益、距离目标价还有多少、价格图上的基准线 / 目标线 / 止损线，以及相对基准的走势图。

### 每天的价格和“判定”

- 价格每个交易日自动更新，不用管。
- 当收盘价触及目标价、止损价，或到达期限时，观点页面和 **Inbox** 会出现提示，比如 “the close on Oct 3 reached your target”。**系统不会自动改状态**，你点 **Mark target hit**（或 “Not now”）确认。
- 修改方向、信心、目标价、止损或期限时，网站会请你写一句原因，自动记录成一条带日期的版本（Revisions），历史永远保留。
- 观点结束时，在编辑器 **Status and review** 里写复盘（Post-mortem）。

### 周报 / 半月报 / 月报

- **Journal** → **New entry**：选择周期（周 / 两周 / 月 / 季），自带模板（本期变化、瓶颈移到哪里、我的观点被验证或挑战、下期关注），可以勾选这一期写过的观点和笔记。
- **Update outlook**：更新“当前瓶颈在哪里”和五层各自的立场。每次更新会保存为新的快照，历史判断自动形成时间线，首页右上角显示最新判断。

### 研报库

- **Research** → **Add a report** 上传：
  - Claude 写的 HTML 报告：默认公开（上传前请确认里面没有个人信息）。
  - 卖方 PDF：**永远私有**，只存在私有仓库，只有你登录后能打开。
- 研报按月份 / 公司 / 行业分组，每组默认显示最近 5 篇，其余折叠。
- 双语报告可以在阅读页右上角切换 English / 中文。

### Inbox（待办）

右上角 Owner 标记 → Settings → Open inbox，或直接访问 `#/inbox`：待确认的价格判定、到期该复查的观点、待翻译的中文内容、未读的私有研报。

---

## 四、翻译：你写中文，访客看英文

- 你可以全部用中文写。公开页面会显示英文翻译，访客可以点 “中文原文” 看原文。
- 翻译由 Claude 完成：在 Claude Code 里对这个仓库说 **“把待翻译的笔记翻译成英文”** 即可。
- 翻译完成前，公开页面显示中文原文，并标注 “EN pending”。
- 之后改了原文，网站会自动识别翻译“过期”，下次一起重新翻译。
- 以后可以让 Claude 设置一个每天自动运行的任务（Routine），自动翻译和收集新闻。

---

## 五、隐私

- 观点、笔记、周报 **默认私有**。
- 公开的观点默认 **隐藏** 目标价、止损、情景、交易计划、仓位；可以在编辑器 **Visibility** 里逐条勾选公开。
- 卖方研报受版权保护，永远不会进入公开仓库。
- 你的 token 只保存在你自己的浏览器里，只发给 GitHub。
- 实验版期间网站对搜索引擎设置了不收录（noindex）。
- 提醒：你上传过的“AI 短剧”报告里有个人信息（签证身份等），已经放在私有区，没有公开。如果想公开，可以让 Claude 先做一个去掉个人信息的版本。

---

## 六、直接交给 Claude 的事（中文说就行）

- “把这个 HTML 报告归档到研究库”（附上文件）
- “把这份卖方 PDF 放进私有库，公司是 SK 海力士”
- “在存储行业加一家公司：Kioxia”
- “这周的新闻帮我更新一下，每一层都要有”
- “把待翻译的笔记翻译成英文”
- “首页的某某改成某某” / “加一个主题：液冷”
- “这个观点改成公开，但不公开目标价”
- “合并到 main 并上线”

---

## 七、常见问题

**保存后公开网站多久更新？** 约 2–3 分钟（GitHub 自动重新构建网站）。私有内容保存后立即生效，只有你能看到。

**价格什么时候更新？** 亚洲收盘后（约 UTC 10:30）和美股收盘后（约 UTC 21:35）。周末、节假日没有新价格。

**登录提示 token 不能用？** 可能已过期或权限不够。按第二部分第 4 步重新生成，然后重新登录。

**换了手机 / 电脑？** 在新设备上打开 Settings 重新登录一次即可。

**不小心删了东西？** GitHub 会保留所有历史版本，告诉 Claude，它可以恢复。

**价格看起来不对？** 拆股会自动处理；如果某只股票的价格明显异常，告诉 Claude 检查 ticker。

# 快手字段与 API 可行性调研

> 调研日期：2026-09-24
>
> 目标：确认快手推荐流能拿到哪些达人字段，区分快手主页 ID、快手号和主页地址，并筛选可借鉴的公开项目。
> 证据分层：`官方文档` 表示快手公开文档明确写出的能力；`网站观察` 表示当前网页或本仓库选择器观察到的结果；`公开源码` 表示 GitHub 项目的实现方式。网站私有接口不能当作官方 API 合同。

## 结论

1. **主页路径键（eid-like）、GraphQL `user_id`/`principalId`、快手号、`open_id` 需要分栏保存。** 当前网页 `/profile/<id>` 中的路径值只是本系统观察到的主页路径键，不能在没有实测映射的情况下和 GraphQL `user_id` 或 `principalId` 合并。快手官方文档另外把“快手 UID/快手 ID”和“快手号”并列为两个输入，并说明它们对具体用户都唯一；快手号输入会被平台转换为 UID。[服务号跳转文档](https://open.kuaishou.com/docs/develop/functionAccessGuide/businessAccount/skip)；[打开用户主页按钮](https://open.kuaishou.com/docs/develop/components/form/button.html)。官方订单字段也明确写成“快手 ID，注意区别于快手号”。[订单查询响应参数](https://open.kuaishou.com/docs/develop/server/epay/open-api-new/orderQuery-new.html)
2. **截至本次检索，官方公开用户信息接口没有返回快手号或主页 URL。** `GetUserInfo` 要求用户授权 `user_info`，文档列出的返回字段是 `name`、`sex`、`fan`、`follow`、`head`、`bigHead`、`city`。[用户公开信息 API](https://open.kuaishou.com/platformDocs/openAbility/userInformation/publicInformation) 这不是“输入任意主页 ID 查达人”的公共发现接口；官方网页应用流程同样要求注册应用、用户授权和 OAuth code。[网站应用 OAuth](https://open.kuaishou.com/platformDocs/develop/web-app)
3. **当前找不到一个已由官方公开文档确认、可输入任意主页 ID 并返回快手号和主页 URL 的通用公共 API。** 这是对公开文档的检索结论，不代表快手不存在商务接口或登录态内部接口。官方接口可用范围受应用审核和权限 scope 约束。[开放平台登录与应用审核](https://open.kuaishou.com/platformDocs/newGuide/login)
4. **采集条件是“主页路径键 + 规范主页 URL”；现有下游绑定条件是“主页 URL + 快手号”。** 主页路径键用于从推荐卡进入主页，规范 URL 用于确认读取的是同一个主页；下游绑定或发送请求仍需按当前业务约束提供 `kuaishou_number`。当前网页资料中出现 `.uid` 或“快手号：…”时再保存快手号；没有该字段时保留缺失，不能把主页路径键、`principalId` 或视频作者 ID 推导成快手号。[当前快手页读取实现](../lib/kuaishou-page.js)；[当前任务主页校验](../lib/kuaishou-task.js)
5. **类似 `bilibili-gate` 的快手项目主要是浏览器登录态采集器，不是稳定的官方 API SDK。** `RSSHub` 使用 Playwright 拦截快手网页的 `/live_api/...` 响应；`ShilongLee/Crawler` 使用带 Cookie 的 `https://www.kuaishou.com/graphql`；`ForgeRSS` 使用登录浏览器、CDP 和 profile URL/ID。它们可借鉴页面生命周期与字段提取，但都不能证明能稳定返回快手号。[RSSHub 快手路由](https://raw.githubusercontent.com/DIYgod/RSSHub/master/lib/routes/kuaishou/profile.ts)；[Crawler 快手文档](https://github.com/ShilongLee/Crawler/blob/main/docs/api/kuaishou/kuaishou.md)；[ForgeRSS 快手说明](https://github.com/tmwgsicp/ForgeRSS/blob/main/README.md)

## 字段与身份边界

| 字段 | 当前可取得位置 | 结论与使用规则 | 证据 |
| --- | --- | --- | --- |
| `profile_path_id` / 主页路径键（eid-like） | 当前主页 URL 的 `/profile/<id>`；推荐卡作者链接 | 这是当前网页路径上的身份键，适合作为本次采集的入口键；不能在没有验证的情况下等同于 GraphQL `user_id`、`principalId`、官方 UID 或快手号。 | [当前实现](../lib/kuaishou-page.js)；[RSSHub 路由参数](https://raw.githubusercontent.com/DIYgod/RSSHub/master/lib/routes/kuaishou/profile.ts) |
| `graphql_user_id` | 登录态 GraphQL 的 `userProfile.profile.user_id` | 单独保存为网页接口观察字段；当前没有验证它和 `profile_path_id`/`principalId` 的一一映射，不能直接合并为同一身份键。 | [Crawler profile.graphql](https://raw.githubusercontent.com/ShilongLee/Crawler/main/service/kuaishou/logic/graphql/profile.graphql) |
| `principal_id` | RSSHub 快手路由接收的 `principalId` 参数 | 单独保存为项目输入参数或网页观察值；RSSHub 源码没有证明它和主页路径键或 GraphQL `user_id` 可互换。 | [RSSHub 快手路由](https://raw.githubusercontent.com/DIYgod/RSSHub/master/lib/routes/kuaishou/profile.ts) |
| `profile_url` | 打开主页后的规范地址 | 当前解析器按路径生成 `https://www.kuaishou.com/profile/<id>`，用于任务校验和下游主页绑定；它不是官方 `GetUserInfo` 返回字段。推荐卡原始 `href` 可能带 query，应另存为 `raw_profile_url`，不要丢掉原始观测证据。 | [当前主页读取](../lib/kuaishou-page.js)；[当前任务校验](../lib/kuaishou-task.js) |
| `kuaishou_number` / `kwaiId` / 快手号 | 主页 DOM 中可见的“快手号/快手账号”文本；官方文档中作为跳转参数 | 可能为空。只有字段标签和号码同时被观察到时才保存；不能用 `profile_path_id` 补齐。官方文档确认它和 UID 是不同输入。 | [官方区分 UID 与快手号](https://open.kuaishou.com/docs/develop/functionAccessGuide/businessAccount/skip)；[当前文本解析](../lib/kuaishou-page.js) |
| `open_id` | 第三方登录或小程序授权返回 | 在同一开发者范围内唯一，属于应用/开发者作用域，不适合作为跨应用公共达人身份。 | [第三方登录](https://open.kuaishou.com/docs/develop/functionAccessGuide/thirdPartyLogin) |
| `name`、`sex`、`fan`、`follow`、`head`、`bigHead`、`city` | 官方 `GetUserInfo` | 官方文档列出的授权用户字段；不能据此推断快手号或主页 URL。 | [用户公开信息 API](https://open.kuaishou.com/platformDocs/openAbility/userInformation/publicInformation) |
| `bio`、粉丝数、关注数、作品数 | 主页 DOM；部分登录态网页 GraphQL | 可作为观察字段，但网页字段和接口字段会随站点变化；空值保持空，不能把未加载当成 0。 | [当前主页读取](../lib/kuaishou-page.js)；[Crawler 查询字段](https://raw.githubusercontent.com/ShilongLee/Crawler/main/service/kuaishou/logic/graphql/profile.graphql) |
| 作品 `id`、标题、封面、播放地址、点赞、评论、播放、发布时间 | 官方视频接口或网页 GraphQL/DOM | 官方 SDK 菜单列出视频查询能力；网页项目能读到更多私有字段，但两者不能混称。 | [官方 Server API 菜单](https://open.kuaishou.com/platform/openApi?menu=55)；[Crawler 作品查询](https://raw.githubusercontent.com/ShilongLee/Crawler/main/service/kuaishou/logic/graphql/profile_photo.graphql) |

### 直接回答“能不能拿到快手号”

- **能拿到的情况：** 已登录主页 DOM 的 `.uid` 明确显示“快手号/快手账号”并被读取时，可以保存为 `kuaishou_number`。当前项目的解析规则要求字段标签，并排除与主页路径键完全相同的值，避免把普通作者文本当成快手号。[当前文本解析](../lib/kuaishou-page.js)
- **不能保证的情况：** 官方 `GetUserInfo` 文档未列快手号；公开源码中的 GraphQL profile 查询只请求 `user_id`、`user_name`、头像、简介和计数，也没有 `kwaiId` 字段。[官方用户 API](https://open.kuaishou.com/platformDocs/openAbility/userInformation/publicInformation)；[Crawler profile.graphql](https://raw.githubusercontent.com/ShilongLee/Crawler/main/service/kuaishou/logic/graphql/profile.graphql)
- **因此分两道闸门：** 采集阶段要求 `profile_path_id` 和规范 `profile_url`；现有下游绑定/发送请求要求 `profile_url` 和 `kuaishou_number`。快手号缺失时进入人工确认或等待补采。不要把 `profile_path_id`、`graphql_user_id` 或 `principal_id` 复制到 `kuaishou_number`。

## 官方开放平台能力

### 用户信息与 OAuth

- 网站应用需要注册 `app_id`、`app_secret`，通过用户授权换取 code 和 access token；服务端 token 文档说明 token 也有时效和应用凭证要求。[网站应用 OAuth](https://open.kuaishou.com/platformDocs/develop/web-app)；[获取 access token](https://open.kuaishou.com/docs/develop/server/getAccessToken.html)
- `GetUserInfo` 的公开文档明确要求 `user_info` 授权 scope，并把请求地址写为 `GET https://open.kuaishou.com/openapi/user_info`；它只列出基础资料和关系计数，适合“用户授权后读取该用户”，不等同于“按任意达人主页 ID 公共搜索”。[用户公开信息 API](https://open.kuaishou.com/platformDocs/openAbility/userInformation/publicInformation)
- `open_id` 是开发者范围内的唯一用户标识；它与网页主页 ID、快手 ID、快手号的作用域不同。[第三方登录](https://open.kuaishou.com/docs/develop/functionAccessGuide/thirdPartyLogin)

### 官方 ID 规则

- 小程序 `openProfile` 支持传入用户 ID 或快手号，官方说明两者都能唯一指向具体用户，并且传快手号时平台会先转换成 UID。[服务号跳转文档](https://open.kuaishou.com/docs/develop/functionAccessGuide/businessAccount/skip)
- 这说明“能用来打开主页”不等于“API 会返回该字段”，也不能从官方按钮参数反推出网页主页 URL 模板。[打开用户主页按钮](https://open.kuaishou.com/docs/develop/components/form/button.html)
- 快手帮助页还把用户 ID 和快手号作为不同概念说明；快手号是在个人资料中设置或升级得到的账号标识。[如何设置快手号](https://www.kuaishou.com/help/feedback/2658)；[用户 ID 与快手号](https://www.kuaishou.com/help/feedback/2656?categoryId=2635&subCategoryId=2655)

### 达人开放平台边界

官方达人开放平台的指定达人流程使用 UID 搜索已入驻达人，属于签约/任务业务场景，不是对全站任意用户开放的通用创作者发现接口。[达人开放平台指定达人](https://open.kuaishou.com/docs/operate/reviewSpecification/sparkProject/sparkProject.html) 旧的批量上传接口页面还注明该接口已于 2025-10-31 关闭，接入时应以当前分销/任务文档为准。[开放平台上传与任务](https://open.kuaishou.com/docs/develop/server/openplatform/upload.html)

## 网站接口与公开源码

### 当前网页和本仓库观察

当前仓库的快手推荐任务从视频卡读取作者链接，将 `/profile/<id>` 中的值作为 `authorId`（本报告称 `profile_path_id`）。视频规则明确淘汰时跳过主页；规则通过或指标缺失、需要复核时打开主页，按路径生成规范 `profile_url`，再读取粉丝、简介、近期作品和可见的快手号文本。推荐卡原始链接仍可带 query，规范主页读取会按路径确认同一主页；主页完整作品列表仍标记为未完成。[快手推荐流说明](./快手推荐流.md)；[页面读取实现](../lib/kuaishou-page.js)；[当前任务主页校验](../lib/kuaishou-task.js)

2026-09-24 在用户已登录的 Chrome 中做了只读页面核验。推荐流 1 条当前视频的作者链接、视频 ID、时长、点赞、评论、收藏、头像和封面均可由现有选择器读取；其作者主页 `/profile/3x6cvhyfmvk6x79` 展示的快手号是 `4468565578`。另一个公开主页 `/profile/3xt6e7xavy9vxra` 展示的快手号是 `3913621640`。两例中主页路径键与快手号都不同，主页 URL、快手号、粉丝数、头像和前 20 条可见作品均成功读取；简介为 1/2。此处的 2/2 只是定向样本，不代表全站覆盖率。主页刚打开时曾短暂出现登录提示，加载完成后显示已登录资料，因此任务读取应等待主页字段加载。[样本主页一](https://www.kuaishou.com/profile/3x6cvhyfmvk6x79)；[样本主页二](https://www.kuaishou.com/profile/3xt6e7xavy9vxra)

网页上的 [`https://www.kuaishou.com/graphql`](https://www.kuaishou.com/graphql) 是站点请求地址，不属于官方开放平台公开 API。一次不带用户 Cookie 的 `visionProfile` 请求在 2026-09-24 返回 `result=2` 且 `userProfile=null`；这只能说明该次无登录态请求没有形成可用样本，不能推断所有登录态都失败，也不能当作稳定接口合同。不要把 Cookie、token 或完整请求头写入文档、日志或服务端配置。

### GitHub 项目对比

维护状态按 GitHub 仓库元数据与源码快照在 2026-09-24 检查；项目活跃只表示仓库近期有代码或自动化更新，不表示快手接口稳定，也不表示项目能返回快手号。

| 项目 | 当前实现 | 可借鉴之处 | 与本系统的差距 |
| --- | --- | --- | --- |
| [`DIYgod/RSSHub`](https://github.com/DIYgod/RSSHub) 的 [快手 profile 路由](https://raw.githubusercontent.com/DIYgod/RSSHub/master/lib/routes/kuaishou/profile.ts) | 维护中的通用 RSS 项目；Playwright 打开快手直播主页，并拦截 `/live_api/profile/public` 与 `/live_api/baseuser/userinfo/byid`。 | 页面加载、重试、响应拦截和作品 RSS 化。 | 依赖网页私有响应；路由参数是 `principalId`；源码没有快手号提取，也没有推荐流筛选和业务请求发送。 |
| [`ShilongLee/Crawler`](https://github.com/ShilongLee/Crawler) 的 [快手 API 文档](https://github.com/ShilongLee/Crawler/blob/main/docs/api/kuaishou/kuaishou.md) | 维护中的多平台爬虫服务；快手账号接口要求保存 Cookie，用户接口按主页 ID 请求 `visionProfile` 和作品分页。 | profile/作品字段拆分、分页和任务服务封装。 | Cookie 是登录态私有凭证；[profile 查询](https://raw.githubusercontent.com/ShilongLee/Crawler/main/service/kuaishou/logic/graphql/profile.graphql)只请求 `user_id`、昵称、头像、简介和计数，没有 `kwaiId`/快手号。 |
| [`tmwgsicp/ForgeRSS`](https://github.com/tmwgsicp/ForgeRSS) 的 [快手 scraper](https://raw.githubusercontent.com/tmwgsicp/ForgeRSS/main/generators/social/kuaishou/scraper.py) | 维护中的本地 RSS 项目；要求 DrissionPage、登录浏览器、CDP，可接收用户 ID、主页 URL 或分享短链。 | 登录态生命周期、验证码/登录状态检测、短链到主页的输入归一。 | 主要输出作品 RSS 和下载链接；没有快手号、粉丝或简介字段，也没有通用达人请求流程。 |
| [`magicdawn/Bilibili-Gate`](https://github.com/magicdawn/Bilibili-Gate) | 维护中的 B 站浏览器用户脚本，适合做“推荐流 + 过滤 + 页面增强”的交互基线。 | 推荐流操作、用户侧控制和浏览器内运行方式。 | 目标平台是 B 站；仓库不能作为快手字段或快手 API 证据。 |
| [`KwaiOpen/KwaiOpenSDK`](https://github.com/KwaiOpen/KwaiOpenSDK) | 名为 `KwaiOpen` 的旧 SDK 仓库，代码最近一次推送为 2022-04-19；覆盖 OAuth/开放平台方向。 | 可作为旧接口命名和授权流程线索。 | 代码更新滞后；当前接入应以快手官方文档为准，不能把仓库当现行发现 API。 |
| [`KwaiVideoTeam/kuaishou-liveopen-api`](https://github.com/KwaiVideoTeam/kuaishou-liveopen-api) | 以 `KwaiVideoTeam` 名义发布的旧直播开放 API 示例，代码最近一次推送为 2020-12-31。 | 直播开放平台的历史接口结构。 | 目标是直播推流/状态等能力，不是推荐流达人发现，不能解决快手号补全。 |
| [`helpcode/KuaiShou`](https://github.com/helpcode/KuaiShou) | 历史抓取项目；README 已明确说明旧接口失效并转向 PC 端登录态/GraphQL。 | 只能作为历史字段名称和失效原因的线索。 | 不应复用旧接口；README 中曾出现的 `kwaiId` 等字段没有当前可用性证明。 |
| [`zhuovi/XiaoFeng.KuaiShou`](https://github.com/zhuovi/XiaoFeng.KuaiShou) | 小型 .NET 官方开放平台封装，代码最近一次推送为 2024-02-27。 | 可参考 `GetAccessToken`/`GetUserInfo` 的 SDK 包装形态。 | 更新和使用规模有限；未解决任意达人发现、主页 URL 或快手号返回。 |

项目的维护时间依据 GitHub 仓库元数据检查：[RSSHub](https://api.github.com/repos/DIYgod/RSSHub)、[Crawler](https://api.github.com/repos/ShilongLee/Crawler)、[ForgeRSS](https://api.github.com/repos/tmwgsicp/ForgeRSS)、[KwaiOpenSDK](https://api.github.com/repos/KwaiOpen/KwaiOpenSDK)、[liveopen-api](https://api.github.com/repos/KwaiVideoTeam/kuaishou-liveopen-api)、[KuaiShou](https://api.github.com/repos/helpcode/KuaiShou)、[Bilibili-Gate](https://api.github.com/repos/magicdawn/Bilibili-Gate)、[XiaoFeng.KuaiShou](https://api.github.com/repos/zhuovi/XiaoFeng.KuaiShou)。

## 接入建议

### 最小字段模型

建议在跨平台候选记录中分开保存以下字段：

```text
platform                 = "kuaishou"
profile_path_id          = /profile/<id> 的主页路径键（eid-like）
graphql_user_id          = 可选；仅保存登录态网页响应中的 user_id
principal_id             = 可选；仅保存来源明确的 principalId
kuaishou_number          = 可空；仅来自带“快手号/快手账号”标签的实际观察
profile_url              = 规范主页地址，用于任务校验和下游绑定
raw_profile_url          = 可选；推荐卡原始 href，保留 query 等观测证据
identity_source          = card_profile_link | profile_dom_uid | logged_in_graphql
observed_at              = 观察时间
identity_evidence        = 页面字段或响应字段的脱敏摘要，不保存 Cookie/token
```

当前上传合同中，主页路径键写在 `rpa_feedback.kuaishou_user_id`，观察到的快手号写在 `rpa_feedback.kuaishou_id`，主页链接写在 `author_href`；推荐卡原始链接仍保存在本地原始观测的 `profileUrl` 中。[上传实现](../background.js) 上述建议模型中的 GraphQL ID 和 `principalId` 尚未接入，不能用现有字段推断填充。

采集与绑定分别使用以下前置条件：

1. 推荐卡必须先得到 `profile_path_id` 和规范 `profile_url`，两者缺一则暂停该达人观察；若采用上面的建议模型，将原始卡片链接另存为 `raw_profile_url`。
2. 主页读取成功后，若能看到带标签的快手号，填充 `kuaishou_number`；看不到就保持空值并记录缺失原因。
3. 现有下游绑定或发送请求要求 `profile_url` 与 `kuaishou_number`；快手号缺失时进入人工确认，不发送 `profile_path_id`、`graphql_user_id` 或 `principal_id` 作为替代值。
4. `open_id` 只在同一官方应用授权链路中使用，不写入跨平台公共身份字段。[第三方登录](https://open.kuaishou.com/docs/develop/functionAccessGuide/thirdPartyLogin)

### 实现优先级

1. **保持当前 DOM 主页读取。** 已登录的真实页面验证了推荐卡到主页的选择器链；当前代码从推荐卡取得主页路径键和链接，从可访问的主页读取粉丝、简介、可见作品和带标签的快手号。两例页面核验仍不能替代新版本插件的完整采集与上传验收。[当前实现](../lib/kuaishou-page.js)
2. **不为“补快手号”直接加入服务端 Cookie 重放。** Crawler、RSSHub、ForgeRSS 的成功依赖登录浏览器或私有网页响应，无法证明字段稳定；服务端保存或转发用户 Cookie 还会扩大凭证风险。[Crawler Cookie 文档](https://github.com/ShilongLee/Crawler/blob/main/docs/api/kuaishou/kuaishou.md)；[RSSHub 网页响应拦截](https://raw.githubusercontent.com/DIYgod/RSSHub/master/lib/routes/kuaishou/profile.ts)
3. **若后续验证 GraphQL，只做浏览器当前会话的只读观察。** 记录实际返回字段名和覆盖率，任何没有“快手号”字段的响应都不能用于填充 `kuaishou_number`。
4. **需要规模化、合规地读授权用户资料时再接官方 OAuth。** 先确定应用类型、scope、审核和用户授权，再针对官方文档列出的字段接入；官方公开文档目前不支持把它当作任意达人发现接口。[开放平台登录](https://open.kuaishou.com/platformDocs/newGuide/login)

### 验收口径

每次快手采集至少记录四个覆盖率：`profile_path_id_non_empty`、`profile_url_non_empty`、`kuaishou_number_non_empty`、`profile_read_success`。其中快手号覆盖率允许低于主页路径键覆盖率；只有前两项满足时，候选才具备采集阶段的主页读取条件；现有下游绑定仍需主页 URL 和快手号。不要用“快手号覆盖率 100%”作为假性完成标准。

## 风险和限制

- 快手网页 DOM、GraphQL operation、响应字段和反爬策略可能变化；公开项目的近期提交只能证明代码有维护，不能证明接口长期兼容。[快手官网](https://www.kuaishou.com/)
- 官方 API 文档与网页私有接口属于两套授权和稳定性边界；不能把 `user_id`、`principalId`、`author_id`、`open_id`、快手号互相转换，除非当前接口文档明确规定转换关系。[官方 ID 区分](https://open.kuaishou.com/docs/develop/functionAccessGuide/businessAccount/skip)；[订单字段区分](https://open.kuaishou.com/docs/develop/server/epay/open-api-new/orderQuery-new.html)
- 本报告没有记录任何 Cookie、access token、app secret 或浏览器会话数据。已登录页面的 2 个公开主页样本均显示快手号；仍需在新版本插件实际运行后统计覆盖率和下游绑定结果。

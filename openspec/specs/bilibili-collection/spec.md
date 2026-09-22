# B 站采集规格

## Purpose

记录 B 站采集借鉴了哪些开源项目，以及每个官网接口返回哪些字段、哪些进入研究台上传、哪些不上传。采集使用当前浏览器里的 B 站登录态，调用官网自己的网页接口。

## Requirements

### Requirement: 借鉴来源只作参考

采集实现 SHALL 记录并遵守以下来源边界：

- [Bilibili-Gate](https://github.com/magicdawn/Bilibili-Gate)（作者 magicdawn，原名 `bilibili-app-recommend`，MIT）提供了网页推荐的做法：`/x/web-interface/wbi/index/top/feed/rcmd`、WBI 签名、每批 `ps=30`。2026-09-15 接入时对照过该仓库，不安装、不打包、不在运行时依赖它。
- [bilibili-API-collect](https://github.com/SocialSisterYi/bilibili-API-collect)（SocialSisterYi）用来核对综合热门、空间投稿和 WBI 的公开字段说明，不复制进本仓库。

#### Scenario: 扩展可以在没有这两个仓库的环境运行

- **GIVEN** 构建产物里没有 Bilibili-Gate 或 bilibili-API-collect 的源码或包
- **WHEN** 已登录的 B 站标签页开始采集
- **THEN** 采集仍只调用 `api.bilibili.com` 上的官网接口

### Requirement: 规则淘汰不补抓

直接淘汰的视频 SHALL NOT 请求视频详情或粉丝数。未对上淘汰或理想规则、交给人工的视频 SHALL 仍补抓这两项。采集 SHALL NOT 请求作者投稿列表。

#### Scenario: 播放量低于剔除线

- **GIVEN** 推荐或热门返回一条播放量低于直接剔除线的视频
- **WHEN** 系统完成规则判断
- **THEN** 上传包含这张列表卡片（`feed_item`）
- **AND** 不出现 `view_detail` 和 `relation_stat`
- **AND** 不请求作者投稿

### Requirement: 规则命中后补两次

视频规则命中后，系统 SHALL 按这个顺序各请求一次，请求前 SHALL NOT 等待：

1. `/x/web-interface/wbi/view`：当前视频详情
2. `/x/relation/stat`：粉丝数

系统 SHALL NOT 请求 `/x/space/wbi/arc/search`。任一补抓失败 SHALL NOT 中止本轮，命中结果仍上传。

#### Scenario: 命中视频不拉作者投稿

- **GIVEN** 一条视频命中规则
- **WHEN** 补抓完成
- **THEN** 已请求视频详情和粉丝数
- **AND** 未请求作者投稿列表

### Requirement: 登录接口不上传

`/x/web-interface/nav` SHALL 只用于判断是否登录和读取 WBI 密钥。系统 SHALL NOT 把该响应里的登录用户信息写入采集上传。

#### Scenario: 开始采集前检查登录

- **GIVEN** 用户已在 B 站网页登录
- **WHEN** 采集读取 nav
- **THEN** 后续接口可以签名
- **AND** 上传记录里没有 nav 的用户资料

### Requirement: 视频卡片原样上传

推荐和综合热门返回的每条视频卡片 SHALL 原样写入上传记录的 `feed_item`。规范化后的播放、点赞等字段仍写入记录顶层，供现有筛选使用。响应外层的 `business_card`、`floor_info`、`user_feature`、`preload_expose_pct`、`preload_floor_expose_pct`、`mid`（当前登录用户）SHALL NOT 上传。

2026-09-22 实测综合热门单条卡片约 1.6–2.4KB。这些字段写在 `rpa_feedback` 的 JSON 里，不另建数据库列。

`/x/web-interface/wbi/index/top/feed/rcmd` 的视频卡片进入 `feed_item`。该接口的 `stat` 只有播放、点赞、弹幕和播放时长，没有评论、投币、收藏、转发。

| 字段 | 含义 | 上传 |
|---|---|---|
| `bvid` | 视频号 | 留 |
| `title` | 标题 | 留 |
| `pic` | 封面 | 留 |
| `duration` | 时长（秒） | 留 |
| `pubdate` | 发布时间 | 留 |
| `uri` | 视频链接 | 留 |
| `owner.mid` / `name` / `face` | 作者 id、昵称、头像 | 留 |
| `stat.view` / `like` / `danmaku` | 播放、点赞、弹幕 | 留 |
| `rcmd_reason.content` | 推荐理由文案 | 留 |
| `id` | avid | 留，在 `feed_item` |
| `cid` | 分 P 的 cid | 留，在 `feed_item` |
| `goto` | 卡片类型，视频是 `av` | 留，在 `feed_item` |
| `pic_4_3` | 4:3 封面 | 留，在 `feed_item` |
| `stat.vt` | 播放时长 | 留，在 `feed_item` |
| `av_feature` | 推荐内部特征串 | 留，在 `feed_item` |
| `is_followed` | 是否已关注 | 留，在 `feed_item` |
| `rcmd_reason.reason_type` | 推荐理由类型 | 留，在 `feed_item` |
| `show_info` | 展示标记 | 留，在 `feed_item` |
| `track_id` | 推荐追踪 id | 留，在 `feed_item` |
| `pos` | 卡片位置 | 留，在 `feed_item` |
| `room_info` | 直播间 | 留，在 `feed_item` |
| `ogv_info` | 影视剧信息 | 留，在 `feed_item` |
| `business_info` | 商业卡信息 | 留，在 `feed_item` |
| `is_stock` | 是否库存推荐 | 留，在 `feed_item` |
| `enable_vt` / `vt_display` | 是否展示播放时长、展示文案 | 留，在 `feed_item` |
| `dislike_switch` / `dislike_switch_pc` | 不喜欢开关 | 留，在 `feed_item` |

`/x/web-interface/popular` 的视频卡片同样进入 `feed_item`。

| 字段 | 含义 | 上传 |
|---|---|---|
| `bvid` | 视频号 | 留 |
| `title` | 标题 | 留 |
| `pic` | 封面 | 留 |
| `duration` | 时长（秒） | 留 |
| `pubdate` | 发布时间 | 留 |
| `short_link_v2` | 短链，当作视频链接 | 留 |
| `tname` | 分区名 | 留 |
| `owner.mid` / `name` / `face` | 作者 id、昵称、头像 | 留 |
| `stat.view` / `like` / `danmaku` / `reply` / `favorite` / `share` | 播放、点赞、弹幕、评论、收藏、转发 | 留 |
| `rcmd_reason.content` | 推荐理由文案 | 留 |
| `aid` | avid | 留，在 `feed_item` |
| `videos` | 分 P 数 | 留，在 `feed_item` |
| `tid` | 分区 id | 留，在 `feed_item` |
| `copyright` | 版权类型 | 留，在 `feed_item` |
| `ctime` | 创建时间 | 留，在 `feed_item` |
| `desc` | 简介 | 留，在 `feed_item` |
| `state` | 稿件状态 | 留，在 `feed_item` |
| `mission_id` | 活动 id | 留，在 `feed_item` |
| `dynamic` | 动态文案 | 留，在 `feed_item` |
| `cid` | 分 P 的 cid | 留，在 `feed_item` |
| `season_id` / `season_type` | 合集 id、类型 | 留，在 `feed_item` |
| `first_frame` | 首帧图 | 留，在 `feed_item` |
| `pub_location` | 发布地 | 留，在 `feed_item` |
| `cover43` | 4:3 封面 | 留，在 `feed_item` |
| `tidv2` / `tnamev2` / `pid_v2` / `pid_name_v2` / `attribute_v3` | 新分区 | 留，在 `feed_item` |
| `current_state` / `global_state` | 审核/状态 | 留，在 `feed_item` |
| `is_ogv` / `ogv_info` | 是否影视剧、影视信息 | 留，在 `feed_item` |
| `enable_vt` | 是否展示播放时长 | 留，在 `feed_item` |
| `ai_rcmd` | 算法推荐信息 | 留，在 `feed_item` |
| `rcmd_reason.corner_mark` | 角标 | 留，在 `feed_item` |
| `stat.aid` / `coin` / `now_rank` / `his_rank` / `dislike` / `vt` / `vv` / `fav_g` / `like_g` | 投币、排名、点踩、播放时长 | 留，在 `feed_item` |
| `rights` | 权限整包：充电、下载、付费、禁转载、合作、自动播放 | 留，在 `feed_item` |
| `dimension` | 宽、高、旋转 | 留，在 `feed_item` |

响应外层仍不上传，见本要求正文。

#### Scenario: 推荐卡片含追踪 id

- **GIVEN** 推荐卡片同时有 `bvid` 和 `track_id`
- **WHEN** 该视频被上传
- **THEN** `feed_item` 含有这个 bvid 和 `track_id`
- **AND** 上传不含当前登录用户的 `user_feature`

#### Scenario: 热门卡片含投币和简介

- **GIVEN** 热门卡片含有 `stat.coin` 和 `desc`，且规则未命中
- **WHEN** 该视频被上传
- **THEN** `feed_item` 含有这条卡片上的投币数和简介

### Requirement: 视频详情原样上传

规则命中后，`/x/web-interface/wbi/view` 的 `data` SHALL 原样写入 `view_detail`。单条观察 JSON 超过 90KB 时，系统 SHALL 先去掉 `view_detail.ugc_season`，并在 `view_detail_clipped` 记下 `ugc_season`。去掉后仍超过 90KB 时，系统 MAY 再按既有顺序丢掉推荐整卡和投稿简介。

| 字段 | 含义 | 上传 |
|---|---|---|
| `bvid` / `aid` | 视频号 | 留 |
| `title` | 标题 | 留 |
| `pic` | 封面 | 留 |
| `desc` | 简介 | 留 |
| `duration` | 时长 | 留 |
| `pubdate` | 发布时间 | 留 |
| `tid` / `tname` | 分区 id、分区名 | 留 |
| `copyright` | 版权类型 | 留 |
| `videos` | 分 P 数 | 留 |
| `stat.view` / `like` / `danmaku` / `reply` / `favorite` / `coin` / `share` | 播放、点赞、弹幕、评论、收藏、投币、转发 | 留 |
| `owner` | 作者 id、昵称、头像 | 留，在 `view_detail` |
| `tid_v2` / `tname_v2` | 新分区 | 留，在 `view_detail` |
| `ctime` | 创建时间 | 留，在 `view_detail` |
| `desc_v2` | 简介分段：`raw_text`、`type`、`biz_id` | 留，在 `view_detail` |
| `state` | 稿件状态 | 留，在 `view_detail` |
| `mission_id` | 活动 id | 留，在 `view_detail` |
| `dynamic` | 动态文案 | 留，在 `view_detail` |
| `cid` | 当前分 P | 留，在 `view_detail` |
| `dimension` | 宽、高、旋转 | 留，在 `view_detail` |
| `season_id` | 合集 id | 留，在 `view_detail` |
| `premiere` | 首播信息 | 留，在 `view_detail` |
| `teenage_mode` | 青少年模式 | 留，在 `view_detail` |
| `is_chargeable_season` | 付费合集 | 留，在 `view_detail` |
| `is_story` / `is_story_play` | 小视频/Story | 留，在 `view_detail` |
| `is_upower_exclusive` / `is_upower_play` / `is_upower_preview` / `is_upower_exclusive_with_qa` | 充电专属 | 留，在 `view_detail` |
| `enable_vt` / `vt_display` | 播放时长展示 | 留，在 `view_detail` |
| `is_hua_sheng` | 花绳标记 | 留，在 `view_detail` |
| `no_cache` | 是否禁缓存 | 留，在 `view_detail` |
| `is_season_display` | 是否展示合集 | 留，在 `view_detail` |
| `need_jump_bv` | 是否跳 BV | 留，在 `view_detail` |
| `disable_show_up_info` | 是否隐藏 UP 信息 | 留，在 `view_detail` |
| `is_view_self` | 是否仅自己可见 | 留，在 `view_detail` |
| `stat.now_rank` / `his_rank` / `dislike` / `evaluation` / `vt` | 排名、点踩、评分、播放时长 | 留，在 `view_detail` |
| `rights` | 权限：充电、下载、付费、禁转载、合作、互动视频、全景、禁分享 | 留，在 `view_detail` |
| `argue_info` | 争议提示：文案、类型、链接 | 留，在 `view_detail` |
| `pages` | 分 P 列表：cid、标题、时长、宽高、首帧、创建时间 | 留，在 `view_detail` |
| `subtitle` | 字幕 | 留，在 `view_detail` |
| `label` | 标签 | 留，在 `view_detail` |
| `ugc_season` | 合集：标题、封面、简介、集数、是否付费、各集 | 留；单条超过 90KB 时裁掉并记入 `view_detail_clipped` |
| `user_garb` | 装扮 | 留，在 `view_detail` |
| `honor_reply` | 荣誉，如每周必看 | 留，在 `view_detail` |
| `like_icon` | 点赞图标 | 留，在 `view_detail` |

#### Scenario: 命中视频的详情含分 P 和投币

- **GIVEN** 一条命中视频的详情同时含有 `stat.coin` 和 `pages`
- **WHEN** 补抓完成并上传
- **THEN** `view_detail` 含有投币数和 `pages`

#### Scenario: 合集分集列表超出单条上限

- **GIVEN** 详情里的 `ugc_season` 使这条观察超过 90KB
- **WHEN** 系统裁剪后上传
- **THEN** `view_detail` 不含 `ugc_season`
- **AND** `view_detail_clipped` 含有 `ugc_season`
- **AND** 同条记录里的推荐卡片仍然保留

### Requirement: 关系接口原样上传

规则命中后，`/x/relation/stat` 的 `data` SHALL 原样写入 `relation_stat`，其中包含粉丝数 `follower`。

| 字段 | 含义 | 上传 |
|---|---|---|
| `follower` | 粉丝数 | 留 |
| `mid` | 用户 id | 留，在 `relation_stat` |
| `following` | 关注数 | 留，在 `relation_stat` |
| `whisper` | 悄悄关注数 | 留，在 `relation_stat` |
| `black` | 黑名单数 | 留，在 `relation_stat` |
| `fans_medal_toast` / `fans_effect` | 粉丝牌提示、特效 | 留，在 `relation_stat` |

#### Scenario: 关系接口返回关注数

- **GIVEN** 命中作者的关系接口同时返回 `follower` 和 `following`
- **WHEN** 结果上传
- **THEN** `relation_stat` 含有粉丝数和关注数

### Requirement: 作者投稿补抓已暂停

2026-09-23 起采集 SHALL NOT 调用 `/x/space/wbi/arc/search`。命中结果的 `author_archives` 留空，不写投稿总数、分区列表或合集按钮。

调用留在 `lib/bilibili-api.js` 的 `enrichMatchedBilibili` 块注释中，便于加回。恢复时去掉该注释，并让返回值使用注释里的 `archives`、`archiveCount`、`archivesComplete`、`partitions`、`episodicButton`。暂停前的顺序是粉丝数之后请求第一页 30 条（`pn=1`、`ps=30`、按发布时间）；当时这次请求前另有 8–16 秒等待，与视频详情、粉丝数的等待一并去掉。写入字段：

- `author_archives`：最新 30 条投稿
- `authorArchiveCount`：投稿总数
- `authorArchivesComplete`：这一页是否已经到末尾
- `authorArchivePartitions`：分区列表 `tlist`
- `authorEpisodicButton`：合集按钮

扩展侧栏的「视频」角标读取本机近 24 小时已采集记录，不读这份投稿列表。

#### Scenario: 命中作者不拉投稿

- **GIVEN** 一条视频命中规则
- **WHEN** 补抓完成并上传
- **THEN** 上传记录没有作者投稿列表

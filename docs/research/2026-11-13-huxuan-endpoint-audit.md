# 腾讯互选主页端点与公开实现核查

记录时间：2026-11-13（北京时间）。目标是为筛选后的达人保留完整、可用的数据，同时核对哪些请求在同一主页可以复用。本文件区分官网静态代码、历史样本、公开项目和仍需实测的部分；不保存账号、Cookie、请求头、联系人或原始响应。

## 证据范围

- 本次从腾讯 CDN 成功下载历史验收引用的 [FinderSelectionDetail-61df17c2.js](https://file.daihuo.qq.com/fe_free_trade/release_3.278.1/assets/FinderSelectionDetail-61df17c2.js)（HTTP 200，116,207 字节，SHA-256 `3c5aa4b485da9373532462421137a9647cea96b8ff0bfcc4afdc68cfe0c8d161`）、[VideoTypeTag-3255c2c4.js](https://file.daihuo.qq.com/fe_free_trade/release_3.278.1/assets/VideoTypeTag-3255c2c4.js) 和 [FinderTableData-ec1f6429.js](https://file.daihuo.qq.com/fe_free_trade/release_3.278.1/assets/FinderTableData-ec1f6429.js)。使用 esbuild 格式化后检查调用；以上均为 `release_3.278.1` 历史静态资源，不等同于当前登录网页的抓包。
- [既有验收](../verification/2026-11-10-huxuan-full-profile.md)记录了两位达人的 26 次主页／作品请求，使用的是页面桥接与采集协调器构造请求；不能将这 26 次解释为用户正常点击主页时的原生网络瀑布，也不能外推到全部账号。
- 本轮当前登录页面的原生点击抓包由主任务核验；若浏览器连接不可用，无法据此给出当前网站实际并发数、顺序、服务端限制或全部接口清单。

## 已发现的主页请求关系

| 栏目 | 历史官网源码可证实内容 | 对本插件的意义 |
| --- | --- | --- |
| 主页聚合 `detail` | 页面请求 `detail`，直接读取响应中的 `item`、`user_profile` 和 `viewer_profile`。 | 基础资料、粉丝画像和观众画像可由同一响应取得；不同人群保持独立。历史验收还记录 `near_videos`，但需与独立趋势响应按同账号、时间窗和类型逐字段对照。 |
| 最近视频趋势 `near_videos` | 源码中趋势组件请求 `video_type=ALL`（枚举 0），从同一响应读取 `personal_video_data`、`order_video_data` 并依据 `stat.flag` 本地切换个人／商单。 | 当前插件另请求 `near:3` 和 `near:1`。这是明确的潜在重复请求；是否可以删除，仍需用真实响应对比字段、数值、时间窗、类型与缺失场景，不能仅凭同名推断等价。 |
| 发表视频与商单作品 | 页面 hook 默认近180天、`video_type=ALL`、`page_index=0`；日期、页码或类型发生变化时请求 `get_finder_video_show`。分页控件显示每页8条，并将显示页码减1传为 `page_index`；请求参数没有显式 `page_size`。 | 静态源码支持“首次显示请求第0页、切换或翻页再请求”，并不支持“普通用户一次点击就自动请求完整180天全部分页”。控件每页8条不等于已证明服务端每页始终返回8条；需以真实响应核验。 |
| 画像洞察 | `crystal_insight_detail` 在资料中出现相应标记时启用，解析 `cloud_graphs` 和 `audience_insight_stats`。 | 与 `detail` 的粉丝／观众画像属于可能关联但尚未证明等价的栏目，不能未经字段和语义比较而删除。 |
| 亮点、评分与推荐 | `batch_get_publisher_persona`、评分模块中的 `get_finder_publisher_score` 和推荐搜索分别有独立调用；推荐依赖已取得的达人 appid。 | 须按字段、权限和用户实际需求判断是否必要。`appid_list` 是数组，不能仅由参数形状证明批量上限或多账号请求可行。 |

主页组件在不同 React effect 中发起资料、亮点、默认作品等请求，部分栏目等待主页数据或权限标记。静态代码中没有插件这种“每次接口后统一等待几秒”的逻辑；它也不能单独证明真实网络请求全部同时发出、先后次序、重试或最新版本行为。

## 作品和封面

历史主页源码的作品卡从响应使用 `cover_url`，并用 `export_id` 定位作品；趋势图还读取 `video_url`、`description`、`publish_time`、播放、点赞、分享和评论等字段。插件保留各次接口返回的原始业务字段，但这只证明**返回了字段时会被记录**，不能证明每位达人都有封面、视频地址或时长，亦不能证明原始记录已在研究台正确解析、展示或可长期访问。主任务另用合成样例验证了插件原始记录→上传载荷→工作台 `parseHuxuanWork` 对封面、视频地址和时长的传递；这不是实网回包及入库展示验收。视频二级详情与180天以外作品原本不在该次验收范围。

## 本次公开项目检索

2026-11-13 检索了 `"finder_publisher" "huxuan"`、`"get_finder_video_show" "near_videos"`、`腾讯互选 爬虫 GitHub 视频号`、`"batch_get_publisher_persona"` 等，以及 GitHub 仓库名／描述／README 的 `腾讯互选`、`huxuan`、`finder_publisher`。GitHub 仓库搜索不是代码全文搜索；公共 grep.app 查询返回 HTTP 429，不能声称已搜索全部开源代码。

| 项目 | 当前可核查情况 | 适配与缺口 |
| --- | --- | --- |
| [justoneapi-python](https://github.com/justoneapi-official/justoneapi-python/tree/c2ceb0ece8c236d1628146111ab5c7ef9ab8a738) | MIT，非归档，2026-11-12 仍有提交；[互选资源源码](https://github.com/justoneapi-official/justoneapi-python/blob/c2ceb0ece8c236d1628146111ab5c7ef9ab8a738/justoneapi/generated/resources/qq_huxuan.py)列出视频号搜索、详情和指定日期范围作品等第三方服务接口。 | 可作端点和字段对照。它是第三方 API 的 SDK，需要服务 token；其视频号搜索接口仅暴露关键词和页码，不能直接沿用当前官网筛选和广告账号上下文。它不是公开的同源抓取实现，不能证明官网端点已穷尽。 |
| [DemainI/chrome-extension](https://github.com/DemainI/chrome-extension/tree/6ed8a686b8286f615546cd1f5458dedcd4a9190e) | 明确面向互选的收藏助手，最近提交为2025-10-27，GitHub 未识别许可证。[页面拦截器](https://github.com/DemainI/chrome-extension/blob/6ed8a686b8286f615546cd1f5458dedcd4a9190e/src/content/interceptor.js)监听视频号和公众号的列表／详情接口。 | 其[页面逻辑](https://github.com/DemainI/chrome-extension/blob/6ed8a686b8286f615546cd1f5458dedcd4a9190e/src/content/index.tsx)处理详情响应的 `data.item`，未见完整粉丝／观众画像和作品分页处理；并将拦截请求头写入本地存储、输出日志。适合核对页面与端点线索，不符合本任务的完整采集与会话数据边界，且维护和授权状态不足以支持直接复用。 |
| [wx_channel](https://github.com/nobiyou/wx_channel/tree/074a181c0c50bbc9af2698b6e1a98e3c99075065) | MIT，非归档，2026-11-12 仍有提交；面向微信视频号客户端，提供账号和作品等能力。 | 可参考会话、分页与作品处理；当前没有证据证明它支持腾讯广告互选创作者广场的筛选、账号上下文或这些端点。 |
| [MediaCrawler](https://github.com/NanmiCoder/MediaCrawler) | 非归档，2026-11-09 仍有更新；[许可证](https://github.com/NanmiCoder/MediaCrawler/blob/main/LICENSE)限制商业用途和大规模采集。 | 可参考浏览器会话与采集工程方法；现有调查没有找到互选适配，不能把普通视频号／其他平台采集当作互选覆盖，也不应将其直接作为商业依赖。 |

公开搜索还发现同服务方 SDK 镜像；另有视频号互选扩展的授权配置仓库，但其 README 明确不含插件源码。有限检索未发现可直接复用且满足当前官网筛选条件及完整主页范围的成熟开源实现，也不能证明它不存在。

## 仍需用原始证据核验

1. 在正常登录且不干扰现有任务的页面，记录打开一位达人主页的请求时间线、方法、端点、参数字段与实际触发条件；不记录凭据或联系方式。区分主页首屏、切换趋势类型、切换商单、翻作品页和展开详情。
2. 对同一达人、同一账号／时间窗，比较 `detail.near_videos` 与 `near_videos` 的 `ALL/PERSON/ORDER` 全部字段、来源类型和响应缺失情况。相等或可从聚合响应推导时，再确定可消除的请求。
3. 对真实 `get_finder_video_show` 响应逐页核对 `total_cnt`、`page_index`、返回条数、末页、作品 ID、封面、视频 URL 和时长；验证服务端返回字段与研究台实际展示。不能把历史源码中 UI 每页8条当作接口恒定合同。
4. 验证各端点访问受限、缺失、重复作品和断点恢复；按用户要求在运行设置提供可配置的达人之间、列表翻页之间的间隔，并将同一达人内必要请求编排与其余间隔分开验证。

# 星图采集

### Requirement: 稳定身份进入观测合同
系统 SHALL 从星图达人广场已加载的列表响应和达人详情链接取得数字星图 ID。自动采集与边浏览边保存 SHALL 同时把有效星图 ID 写入观测记录顶层 `xingtu_id` 和来源反馈；页面提供主页链接时 SHALL 原样保留。系统 SHALL 识别当前 `/ad/creator/author-homepage/douyin-video/{星图ID}` 详情地址。缺少有效星图 ID 的同名行 SHALL 只保留为观测，不以昵称合并候选达人；抖音身份字段 SHALL 保持缺失，直到对应来源明确返回。

#### Scenario: 页面提供星图 ID
- **WHEN** 页面中的达人链接包含有效数字星图 ID
- **THEN** 自动采集和边浏览边保存生成的观测记录均携带顶层 `xingtu_id`

#### Scenario: 页面缺少星图 ID
- **WHEN** 两行只有相同昵称，没有有效星图 ID 或主页链接
- **THEN** 系统记录页面观测，并保留两行身份缺失状态，不建立或合并候选达人

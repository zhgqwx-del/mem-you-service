# 点滴 Demo 与独立记忆方案的场景核对

核对日期：2026-10-26。输入为 `/Users/zhangguoqiang/Desktop/美柚产品和研发/点滴demo-1014.html`（67,089 行，23,128,969 字节）。采用源码只读检查，未启动网页、未发起真实模型或网络请求。业务脚本主要从 HTML 第 64,995 行开始，其中很多整段编译脚本位于同一行；以下给出原文件行号及可搜索符号，避免把临时格式化文件行号误当原行号。

用户补充的目标调用关系是：**每次记录发送均进入通用记录型 Agent，Agent 内部使用独立记忆服务**。Demo 展示产品意图，不代表现有 Agent 已实现这些能力。

## 1. 最重要的结论

1. 产品是“记录时间线 + 结构化快捷记录 + 多模态识别 + 即时反馈 + 回顾”，不能只按聊天历史召回设计。
2. 记忆需求不仅发生在发送之后。“最近用过的药名/补剂”“上次选择的措施”“当前经期”也会影响发送前的默认项、入口与补全。应有轻量的 recent-items / current-state 读取合同；它们可以由业务后端调用记忆或业务读模型，不必为每次打开 picker 都启动模型。
3. 同一次输入会产生多个事件、观测、卡片。**输入次数、业务事件次数、前端卡片数、AI 反馈数必须分开**。Agent 回复、结构化卡片和统计图是派生结果，不能再次作为新的用户生活事实摄取。
4. 已确认 picker 字段应直接作为用户确认的结构化输入，仍进入 Agent 的业务流程；不需要先还原成自然语言再抽取。自然语言、ASR、OCR 是候选事实，确认和修订状态另存。
5. 需要把“保存本次记录后的统计”做成正式协议。当天总量、近七天计数、最近用药等不能由 top-k 提供，也不能把当前输入既传入 overlay 又提交后重复计入。
6. Demo 大量趋势和分析来自固定数据或混合 mock。它说明需要什么体验，不能证明曲线、周期关联、权限和删除已实现，更不能直接沿用其医学或生活规律措辞。

## 2. 实际展示的能力与证据

| 产品能力 | 原 HTML 位置与符号 | 对服务的含义 |
|---|---|---|
| 文本、按住说话、照片/相册、相机识别、快捷 picker、自然表达补全 | 65073 `DockPublisher`；65100 `VoiceTranscribeInputLayer`；65106 `CameraTransition` / `buildCameraRecognitionResult`；66658 `submitText` / `submitVoice` / `submitCameraRecord` | 统一输入信封需要 `modality`、媒体引用、转写版本、确认字段、来源和客户端操作 ID。 |
| 原始表达与结构化提取分开显示 | 66658 `buildNaturalExtractedEntry` / `appendEntriesByInputSource`；66765 后对 `appendEntriesByInputSource` 的覆盖 | 一条来源可支持多个结构化结果；需要稳定 source/event/observation ID 和片段关联。 |
| 一段语音拆成跨时间事件 | 66658 `appendBabyFeedingTimelineCard`：示例“昨晚3点喝了100ml奶，然后换了1片尿布，早上7点又喝了120ml奶”，三条卡共用 `sourceGroupId` | 批次保存、分事件发生时间与日期、共同来源、部分更正/删除；不能一次请求等于一次喂养。 |
| 经期、育儿模式与多人筛选 | 66658 `recordLifeMode` / `handleRecordModeChange`；65055 `itemMatchesPersonPanelFilter`、`self` / `elder` / `younger` | 所有者不等于事件主体；需要用户拥有/代记的多个 subject，不能只靠文字或当前页面筛选区分宝宝。 |
| 心情、症状、体重、饮食、喝水、用药、补剂、睡眠感受、月经、白带、体温、亲密和排便等 | 66658 `NATURAL_EXTRACT_META`、`PERIOD_DOCK_QUICK_ITEMS`；66930 `installCoreLogic` | 先选数个稳定 schema 和反馈规则；通用检索层之外需要明确领域语义。财务来自用户原始背景，不能因 Demo 偏健康而删掉。 |
| 最近药名/补剂与上次措施 | 66658 `recentMedicationNames` / `recentSupplementNames`，保存后去重并截取 6 个；65653 `medicineOptions` / `supplementOptions`；66539 附近 `LOVE_METHOD_KEY` | 最近使用项属于确定性读模型，保留主体、域、最近时间和有效/停用状态；不可把“用过”解释成“现在长期服用”。 |
| 当天用药计数、饮水进度、近七天症状/睡眠/亲密次数与周期反馈 | 66658 `priorMedicationRecords` / `waterFeedback`；66446 `buildWaterInsight`；66548 `buildLoveWeeklyInsight`；66568 `buildSleepWeeklyInsight`；66746 `history` | 需要 metrics / temporal-join 与当前记录一致性，区分记录覆盖、同日多次及事件去重。 |
| 搜索、标签筛选、日期定位、自然语句检索 | 65055 `filterTimelineForSearch` / `isLastMonthWeightQuery`；65058 `StreamSearchOverlay` / `SearchDatePicker` / `XhsStyleSearchPage` | 完整列表和日历用分页、字段/时间查询；语义搜索用于找回；统计走 metrics。不能把一个语义 top-k 接口承诺成三种查询。 |
| 回顾卡、周/月/年/全部、图表展开、全部记录、目标设置 | 65064 `ReviewPage` / `WeightAllRecordsPage` / `DietDetailPage` / `MoodDetailPage` 等；65028 `DailyGoalSettingPage` | 建议独立的产品读模型和图表序列协议，返回来源、覆盖和数据版本；目标为可编辑且有生效时间的状态。 |
| 编辑、改日期、删除、补充、撤销 | 66658 `onEditSave` / `removeTimelineEntry` / `supplementEventQuickRecord` / `undoEventQuickRecord`；67001 编辑 iframe | 编辑不能只改前端文字；需要来源/事实版本、并发检查、派生失效和统计重算。 |
| 模块级共享、伴侣预览、撤销 | 65061 `REVIEW_SHARE_MODULES` / `ReviewShareAuthorization` / `revoke`；65064 `REVIEW_CARD_SHARE_INFO` / `ReviewShareHubPage` | Demo 承诺“回顾可见、原始记录不可见”。需要 share grant / projection，区别于 Agent scope。若暂不做，应明确排出第一期。 |

### 2.1 尾部的最新交互约定应优先作为需求输入

原 HTML 66930–66940 `installCoreLogic` 明确写出：

- 66933：爱爱、便便、白带、体温沿用 picker，直接记录不走提取；爱爱、便便隐藏时间。
- 66934：用药、营养补剂无历史用配置词，有历史展示用户历史。这是记录补全，不应被误解为个体化用药建议。
- 66935：此版本是“睡眠感受”，睡眠时长先不做。虽然 65974 之后仍有旧版 `SleepPicker`、设备同步和时长 UI，后续 66647 附近的 `window.LightQuickComposer` 已以 `SleepFeelPicker` 覆盖。不能把早期代码残留都计入当期范围。
- 66937–66938：月经感受有自由表达与流量/颜色/痛经三合一 picker 两种方案，仅行经期展示。
- 66940：喝水与饮食并存时优先展示饮食反馈，但喝水量照常保存。持久化完整性和反馈优先级是不同决策。

其中隐藏时间仅是 UI 决策，不意味着底层事件不需要发生时间、记录时间和时间精度。

## 3. 哪些计算是真的，哪些是演示

### 3.1 当前本地数据上确实有执行逻辑

- 输入分流和抽取：64999 `extractKeywords` / `extractContentTypes`、65034 `parseWeightFromText`、65109 `parseDietFromText` 使用关键词、词典和正则；不是通用模型理解。
- 事件和卡片追加、同日心情列表、同名用药计数、最近用药去重、部分表单计算、编辑和删除：确实修改本地 React state；没有因此获得后端可靠持久化或索引传播。
- 66746 `history` 从本地结构化症状卡构建七日序列，按日合并同一症状，随后 66765 后生成图表与“有几天记录了疲惫”。这是有用的指标语义样例，但没有处理跨年、完整时区、来源去重或真正的后端一致性。
- 65028 每日目标部分写入 `localStorage`；66539 后上次亲密措施用 `localStorage`，但演示初始化会主动清除此 key。药品历史在 `App` 的 `useState([])` 中，页面重载并无服务端历史保证。

### 3.2 主要是固定数据、定时动画或混合 mock

| 演示内容 | 证据 | 不能推断的能力 |
|---|---|---|
| 体重昨天对比与七日走势 | 65034 `buildWeightAnalysisNote` 令 `yesterdayKg=todayKg+0.5`；`buildWeightWeekChartData` 用固定 `offsets=[0.5,-0.3,-0.1,0.2,1.1,0.5,0]` | 不能推断已查询真实体重历史或支持可信趋势。 |
| 心情趋势与周期文案 | 65031 `MOOD_WEEK_BASELINE`、`buildMoodAnalysisCopy`、`buildPhaseCopy` | 当前心情到固定话术，不代表真实周期或纵向变化已证实。 |
| 饮水七日图 | 66449 `WATER_WEEKLY_MOCK`；66457 附近 `todayDrinks=[['水',250],['咖啡',350]]` 后叠加今天卡片 | 混合了种子和本次记录；正式系统须显式 missing，不能补全为有记录。 |
| 亲密与睡眠七日图 | 66553 `LOVE_WEEKLY_MOCK`；66571 `SLEEP_WEEKLY_MOCK` | 亲密图是种子加本地事件，睡眠图前六日固定、今天取当前输入；不能视为完整历史扫描。 |
| 饮食累计与周平均 | 66658 `buildRecordTabDietWeekData` 固定 seed、`scenarioSeed` 中 `daysWithRecord:6, avgKcal:1380`；65109 `FEEDBACK_DIM_DEMO_PRESETS` | 不代表营养估算、七日均值或统计覆盖已真实实现。 |
| 相机识别和成功/超时/非食物 | 65106 `buildCameraRecognitionResult`；65109 `mockRecognizeDietPhoto`；65112 `simulateDietRecognition` / 定时状态转换 | 主要是场景配置、字典与预置图；真实媒体识别准确性和超时重试尚未证明。 |
| 语音、流式转写 | 65100 `buildVtLiveEntry` / `tick`；66658 `runDemoFlow`；66320 原注释“mock 识别结果” | 当前业务代码未发现 `getUserMedia`、`MediaRecorder`、`SpeechRecognition`，不能视为真实 ASR。 |
| 大量回顾图与“全部记录” | 65064 `REVIEW_CYCLE_ALL_DATA`、`buildWeightLandscapeRecords`、`STOOL_RANGE_META`、`LOVE_RANGE_LABEL` 等 | 回顾大部分从预设数组生成，并非当前时间线的统一读模型。 |
| 分享邀请和撤销 | 65061 `markInvited` / `revoke` / `showToast` 与 65064 分享组件 | 本地状态和 UI 演示，不能证明账号授权或原文隔离。 |

在 64995 行以后的业务脚本中未发现 `fetch(`、`XMLHttpRequest`、`axios` 或 `WebSocket(`；没有证据表明这个文件本身已调用 Agent、记忆服务或真实业务 API。此结论不排除用户另有正在实现的后端，也不与用户希望的目标链路冲突。

## 4. 与现有方案相比需要补齐的部分

现有方案对来源/事件/观测、时间、纠正、删除、混合检索和受控聚合已有正确原则；以下是产品落地仍未闭合的合同。

| 缺口 | 建议补充 |
|---|---|
| 目标调用位置不一致 | 现方案默认“业务后端在 Agent turn 前预取”，应改为 Agent 服务内的可信 adapter / mandatory prepare 阶段读取记忆，随后把结果交给主模型；可保留外围 adapter 作为其他 Agent 的接入选项。内部调用不等于让模型自行决定是否记忆检索。 |
| 发送前补全 | `recent_items` / `current_state` 或由业务读模型实现：主体、域、最近使用值、来源、过期/停用；列表排序需要确定性。 |
| 表单与多模态候选 | 输入区分 `user_confirmed`、ASR/OCR/model candidate、原始媒体；不把 OCR 猜测直接升格为确认测量。用户修改食物份量后热量估算重算，并保留估算模型/数据库版本。 |
| 同一次发送产生多项记录 | 单一 operation 绑定 source；多事件事务/部分状态；生成卡不回灌；一条原文与五张结构卡共用可追溯来源，统计按事件/观测。 |
| 即时反馈必须读到本次 | 规定提交顺序、`min_visible_seq` 与 `include_current/exclude_current`；返回 base seq 与当前 operation 纳入状态。先保存再查询，或明确 provisional overlay，二者都要做到只计一次。 |
| 多种反馈竞争 | Agent 的结构化结果应分别含 `committed_records`、可选 `feedback`、可选 `clarification`、`view_invalidations`。记忆服务返回证据和缺口；产品/Agent 控制展示优先级、频控、是否展开。 |
| 当前产品状态与预测 | 经期第几天、最新一次开始/结束、当前目标、最近药名是有版本的状态视图；周期预测/健康说明是专门领域结果，保留观测依据、算法版本、预测区间与有效时间，不存成已发生事实。 |
| 回顾与日历 | 增加分页事件列表、日历存在性、图表序列/分组指标的读协议；查询不应每次都由大模型扫描全库。更正日期后旧日期和新日期的读模型均失效。 |
| 多主体和共享 | 从“拥有者”中分出“关于谁”及“谁记录”；明确是否一期支持宝宝/伴侣。分享权限应包含 recipient、subject、module、time range、projection 与 grant version，撤销后阻止共享缓存/Agent 继续读取。 |
| 反馈行为自身的状态 | “已经追问过”“已经展示过洞察”“用户撤销”“用户不想看这类提醒”属于交互状态，独立于生活事实。原方案 `open_item.last_surfaced` 可扩展，但不宜把所有前端 UI 状态放进长期语义记忆。 |

## 5. 十个应进入 PoC 的代表场景

| 输入/操作 | Agent 内部所需记忆/查询 | 可验收结果 |
|---|---|---|
| 打开用药快捷输入，选择“布洛芬”并保存 | 发送前 recent-items；保存后本人当天已确认用药事件与同药计数 | 名单来自本人的有效历史；本次计数只增加一次；历史用过不等于持续在用。 |
| “午饭面条，还喝了 300ml 水” | 两个事实候选、当天饮食/饮品统计、已有反馈偏好 | 饮食和喝水都保存；按产品规则只优先展示饮食反馈；不因没有水卡而漏账。 |
| “昨晚又没睡好” | 同主体近七日睡眠感受、近期相关记录、尚未回答的追问 | 用“有几天记录”表达；没有时长不补成 8 小时；无必要时不反复追问。 |
| 月经感受选流量/颜色/痛经，再补“腰酸、烦躁” | 当前周期及用户实际报告的症状、同日已有事件 | 一次来源支持多种观测；症状日计数去重；不把烦躁当临床诊断。 |
| 拍一张体重秤，确认 108.4 斤 | OCR 候选、单位、最近可比观测 | 识别值先为候选；确认后转为 54.2kg 的标准值并保留原单位；无昨日值时不造昨日对比。 |
| 语音说两次喂奶和一次换尿布 | 明确宝宝 ID、发生日期/时间、同一录音来源与已有重复事件 | 三个事件共同来源、跨日准确；重试不会变六条；不串到妈妈或另一个宝宝。 |
| “刚才那杯不是 500，是 300ml”，或在卡片改值/日期 | 精确待更正目标和 source/event 版本，受影响统计视图 | 修订原观测；今日饮水与相关图立即更新；不追加第二杯。 |
| 保存喝咖啡后，近期记录有睡眠困扰 | 有时间边界的睡眠证据、既往提示曝光/用户偏好 | 有依据且适度的承接；不每次重复；不凭相关性断言失眠由咖啡导致。 |
| 搜索“上个月体重”，再打开日历与全部记录 | 正确时区和年份、时间范围列表、图表序列 | 返回完整可分页记录；不固定搜索四月；无记录日期显示 missing。 |
| 删除一段含多个结构卡的录音，再查看伴侣分享回顾 | 来源到派生依赖、删除/共享策略与读视图版本 | 用户明确删除范围；相关事实/图表/缓存/已注入 bundle 同步失效；伙伴只见获授权投影。 |

上述场景可以缩减一期：例如先支持本人、文本/确认 picker、体重/饮水/症状，预留媒体与家庭共享合同。但不能用完整 Demo 的体验声明一期已完备。先以这些具体场景检验契约，比继续扩充开源框架名录更能减少落地风险。

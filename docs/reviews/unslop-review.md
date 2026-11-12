# 首页、明细与分析页 Unslop 专项审查

## 范围与方法

- 本次为独立静态只读审查：以当前工作区代码为准（其中部分文件已有未提交改动），覆盖首页 Tab、明细 Tab、筛选明细、记录详情与分析 Tab；不代表已提交版本的完整状态。
- **视觉未实机验证**：未运行微信开发者工具、未截图、未在真机检查布局、对比度、触控区域、性能或动态效果。以下视觉判断是代码证据支持的风险或设计建议，不是假称已观察到的视觉缺陷。
- 对照 `docs/UI-GUIDELINES.md:5-17` 及 Unslop 的 `references/signs.md:5-99`。项目规范优先：保留暖红、暖背景、现有卡片、navbar、本地图标及允许的渐变；不把移动端 `rpx` 硬套桌面 4px 网格，不因 Unslop 泛化建议而改品牌。
- 代码入口：`miniprogram/pages/index/index.wxml:9-31` 将首页、明细、分析放在同一 Tab 容器；详情在 `miniprogram/pages/record-detail/index.wxml:1-85`，筛选明细在 `miniprogram/pages/record-filtered/index.wxml:1-30`。

## 结论与方向

整体属于**局部精修候选，非全面重设计**：已有真实财务数据、时间与家庭语境、语义色及公共骨架/空状态；静态审查不足以断言屏幕的视觉完成度或所有 slop 类型均不存在。优先解决语义准确、只读入口和公共组件一致性，再通过实机确认视觉层级。

- **产品**：为家庭与个人记录收支、预算和共同开支的小程序。
- **性格**：温暖、可信、清楚。
- **世界**：家庭账本与日常收支；沿用现有暖红与浅暖中性色。
- **重点**：首页的预算余额、分析页真实走势与分类数据；不新增装饰性插画。
- **标识细节**：围绕真实账期、分类及家庭成员信息建立一致的账本阅读语言，避免虚构品牌符号。

## 优先发现

### P1｜生活月报在周、年及收入模式下仍称家庭支出

- 证据：周/月/年共同进入 `miniprogram/components/tl-tab-analysis/index.wxml:71-83` 的“生活月报”；同一弹层固定写“家庭总支出”，但金额来自当前方向的 `dashboardView.totalText`（`miniprogram/components/tl-tab-analysis/index.wxml:596-610`）。复制文本也固定称“生活月报”“家庭支出”（`miniprogram/components/tl-tab-analysis/index.js:1091-1115`）。
- 影响：选收入或非月度时，数据的方向和周期标签可能与实际展示不符；个人账本亦不一定适合“家庭”措辞。该问题可从条件及绑定静态推导，具体输出仍需数据场景验证。
- 建议：按当前账期、收支方向和账本语境动态命名预览及复制内容；或仅在确为月度支出时开放该标题。保留现有功能，补充周/月/年 × 收入/支出 × 个人/共享账本的验证。

### P1｜只读访客仍看到写入入口

- 证据：首页空状态的“记一笔”无权限条件（`miniprogram/components/tl-tab-home/index.wxml:37-41`），明细空状态同样无条件显示（`miniprogram/components/tl-tab-records/index.wxml:88-94`）；两处处理器均在 `readonly` 时仅提示并返回（`miniprogram/components/tl-tab-home/index.js:452-456`、`miniprogram/components/tl-tab-records/index.js:414-418`）。
- 影响：违反 `docs/UI-GUIDELINES.md:16` 的访客无写入口约束，造成可点但不可完成的交互；现有客户端阻止不等于云端授权结论。
- 建议：只读态隐藏写入 CTA，改为中性空状态；保留处理器与云端权限校验作纵深防御。验证访客空账本及空月份。

### P2｜明细页私有按钮与公共组件分叉

- 证据：错误重试和空态操作采用普通 `view.retry-button`（`miniprogram/components/tl-tab-records/index.wxml:46-50,88-94`），样式自行定义尺寸、胶囊圆角与颜色（`miniprogram/components/tl-tab-records/index.wxss:272-285`）；筛选明细已使用 `tl-button`（`miniprogram/pages/record-filtered/index.wxml:9-12`）。
- 影响：与 `docs/UI-GUIDELINES.md:8` 的公共按钮复用冲突，后续交互态、尺寸及无障碍维护容易分叉。
- 建议：以 `tl-button` 的现有变体替代私有按钮，复核不同文案、加载和禁用态，不改品牌圆角体系。

### P2｜预算卡重复表达使用比例，争夺主信息

- 证据：预算状态标签已输出“已使用 N%”，同一卡片右侧又有“已用 N%”；空态和正常态各有一套（`miniprogram/components/tl-tab-home/index.wxml:42-74,112-144`）。
- 影响：非超支时同一比例重复，削弱“剩余可用”与预算状态的层级；是否造成拥挤需设备验证。
- 建议：保留一次明确比例与有意义的超支状态，将预算余额作为主视觉；同时保持进度条的可理解性，合并重复模板可作为后续实现方向。

### P2｜趋势图文字偏小，分类颜色区分可能碰撞

- 证据：自定义范围趋势图走 `getTrendOption`；轴标签设为 `fontSize: 9`，图例为 10（`miniprogram/components/tl-tab-analysis/index.wxml:383-392`、`miniprogram/components/tl-tab-analysis/chart-options.js:178-211,306-315`）。分类颜色由分类键哈希映射到六色，允许多个分类落入同一颜色（`miniprogram/components/tl-tab-analysis/chart-options.js:45-70,120-129`），列表也用同一颜色标识（`miniprogram/components/tl-tab-analysis/index.wxml:253-269`）。
- 影响：小屏可读性和饼图扇区区分有风险；固定哈希不保证同屏颜色唯一。尚未实测 ECharts 缩放和设备呈现。
- 建议：先在目标设备验证轴、图例与长分类名；必要时提高字号并减少刻度密度。分类优先依赖名称、占比及可点列表，避免仅靠颜色；如调整配色需保证图表与列表映射一致，不改变语义色。

### P2｜分析页首屏信息及对比层级可能过密

- 证据：分析概览同时包含总额、笔数/日均、月报入口、结余徽标、比较、叙述、家庭付款以及收入/支出/结余三项（`miniprogram/components/tl-tab-analysis/index.wxml:72-130`）；其中结余重复出现。后续还有走势、日历、排行和分类（`miniprogram/components/tl-tab-analysis/index.wxml:138-245`）。
- 影响：数据都具业务价值，但重复结余和多个并列强调可能稀释当前方向总额；真实折行及首屏范围未验证。
- 建议：保留内容及区块顺序，先减少概览内重复结余或弱化次要标签，将当前周期方向总额与一个趋势作为阅读锚点；采用真实长名称及大金额实机检验。

### P3｜字重及数值格式值得统一核查

- 证据：全局粗体 token 为 700（`miniprogram/app.wxss:119`），首页、明细及分析多处使用该 token（如 `miniprogram/components/tl-tab-home/index.wxss:446-452`、`miniprogram/components/tl-tab-records/index.wxss:272-283`）；详情金额已使用等宽数字（`miniprogram/pages/record-detail/index.wxss:38-44`），分析部分金额标记 `t-num`，自定义汇总部分未标记（`miniprogram/components/tl-tab-analysis/index.wxml:75-87,363-380`）。
- 影响：相较 Unslop 推荐的少量字重，视觉强调可能过多；不同金额对齐方式可能不一致。是否有明显问题要以字体渲染为准。
- 建议：局部对比 500/600 的标签与 700 的关键金额，不直接全局更改 token；核验所有金额使用同一格式和可用的等宽数字策略。

## 按 signs 清单的覆盖与限制

- **颜色/表面**：项目明确保留暖红与允许的背景渐变；没有因通用“灰底单强调色”建议提出换肤。分类多色是数据区分手段，但存在哈希碰撞风险，见上文。
- **文字/图标/文案**：使用本地 `tl-icon`，详情以类型、分类、金额为主（`miniprogram/pages/record-detail/index.wxml:13-22`）；复制的月报含 emoji（`miniprogram/components/tl-tab-analysis/index.js:1109-1115`），属于导出文本而非屏幕图标，可作为文案一致性的低优先级选择，不应误报成页面图标。未发现凭静态证据需要删除的虚构营销数字。
- **间距/布局/组件**：详情字段有固定行距、长值换行与右对齐（`miniprogram/pages/record-detail/index.wxss:66-92`），正向保留；按钮复用与信息重复见上。`rpx` 是响应式单位，不能不经设备换算即断言不符合 4px。
- **动态图与动效**：分析样式包含 `.bar-stem` 高度过渡（`miniprogram/components/tl-tab-analysis/index.wxss:381-385`），但本次未证实该选择器在当前渲染路径被使用，不列为已发生的性能问题；刷新指示动画是否必要需结合交互及设备体验判断。
- **英雄区/通用模板/视觉素材**：本产品为数据型小程序而非营销落地页，落地页 hero、图库和桌面侧栏规则不适用；不建议为填充空间生成图片。是否存在其他视觉征兆，需截图及真机核实。

## 建议验证顺序

1. 以访客、成员、Owner 分别走首页和明细的加载、错误、空及有数据状态；验证只读入口与云端权限。
2. 按周/月/年、收入/支出及个人/共享账本检查月报预览与复制文本和真实汇总一致。
3. 微信开发者工具及真机检查窄屏、大字号、长分类/成员名、大金额、空数据和图表轴标签；对照 `docs/UI-GUIDELINES.md:19-21` 运行项目 UI 检查及分析视觉检查，人工确认差异。
4. 后续若实施修改，按项目规范补齐对应测试与回归；本次仅撰写审查，不修改产品代码，也未运行测试或视觉命令。

---

方法参考：Unslop by Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), CC BY 4.0；本报告为基于项目事实的专项审查，不是技能原文的替代品。

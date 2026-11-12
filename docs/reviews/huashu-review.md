# 首页、明细/详情、分析页面专项评审

## 范围与方法

本报告依据仓库代码静态独立评审，不是新视觉设计方案。首页、明细、分析实际是同一页面内的三个 tab（[页面容器](../../miniprogram/pages/index/index.wxml#L9-L31)）；同时检查记录详情和分析下钻明细。以 [UI 维护规范](../UI-GUIDELINES.md#L3-L17) 为项目约束，结合 huashu-design 评审方法，以 App 的功能性和细节执行优先。严重程度表示潜在用户影响和修复优先级，不等于已复现事故。

未运行小程序、视觉回归或真机测试；未看实际截图、量取颜色对比度和触控尺寸，也未验证云端返回及权限。因缺少真实画面，概念、视觉层级、细节、创新性和总体**不做数值评分**，避免将源码推测冒充视觉评审。以下为代码直接可见的条件与风险，涉及运行效果的地方均需复核。

## 总体判断与保留项

- 产品立意可从“家庭共同记账、关注预算和消费归属”读出：主页有预算与最近记录，分析区有付款人、消费归属和录入人（[首页](../../miniprogram/components/tl-tab-home/index.wxml#L112-L158)、[分析](../../miniprogram/components/tl-tab-analysis/index.wxml#L468-L565)）。这种与家庭账务相关的信息结构值得保留；独特视觉母题是否成立，静态代码无法判定。
- 明细按日期分组并同时显示收入和支出；详情将金额、交易与家庭信息分组，具有清晰的数据组织意图（[明细](../../miniprogram/components/tl-tab-records/index.wxml#L51-L83)、[详情](../../miniprogram/pages/record-detail/index.wxml#L12-L80)）。
- 分析提供图表之外的趋势明细和分类列表，并为分类图表提供失败提示（[分析](../../miniprogram/components/tl-tab-analysis/index.wxml#L143-L185)、[分类](../../miniprogram/components/tl-tab-analysis/index.wxml#L242-L295)）；应保留这些非纯颜色、非纯图形的路径。

## 问题与建议（按优先级）

### P1 · 分析刷新失败后可能没有错误或重试入口

- **证据**：错误态只在 `error && !chartFirstReadyEver` 时展示（[分析模板](../../miniprogram/components/tl-tab-analysis/index.wxml#L59-L68)）；请求失败时清空数据并置 `error: true`，但该分支没有重置 `chartFirstReadyEver`（[分析逻辑](../../miniprogram/components/tl-tab-analysis/index.js#L970-L1014)）。同时错误时内容被隐藏（[样式](../../miniprogram/components/tl-tab-analysis/index.wxss#L37-L48)）。
- **影响**：首次成功后再次请求失败，静态条件显示正文可能空白而没有解释或重试，用户难以区分无数据与网络错误；不符合互斥状态及可恢复反馈要求。
- **建议**：确保首次和后续失败均有可见错误及重试；图表节点是否保留应与错误提示解耦。回归首次成功后断网、切换范围失败和恢复网络的状态。
- **边界**：尚未运行或排除其他全局反馈；需在开发者工具和真机复现确认。

### P1 · 生活月报的周期和收支标题可能误导

- **证据**：“生活月报”入口在周、月、年三种视图均可出现，且收入/支出均可切换（[入口与切换](../../miniprogram/components/tl-tab-analysis/index.wxml#L3-L7)、[概览条件](../../miniprogram/components/tl-tab-analysis/index.wxml#L71-L84)）。弹层固定写“家庭总支出”，却显示随当前类型变化的 `dashboardView.totalText`；复制文本也固定写“家庭支出”和“生活月报”（[弹层](../../miniprogram/components/tl-tab-analysis/index.wxml#L596-L610)、[复制](../../miniprogram/components/tl-tab-analysis/index.js#L1091-L1115)；[数值构造](../../miniprogram/components/tl-tab-analysis/dashboard.js#L278-L282)）。
- **影响**：收入模式可能把收入金额标成支出；周度或年度内容可能被称为月报，复制后的错误口径更易传播。
- **建议**：要么限定入口仅月度支出并说明口径，要么随周期、收支类型和账本性质动态生成标题与复制文案。验证周/月/年 × 收入/支出 × 个人/共享组合，核对数值来源。
- **边界**：未在运行时验证实际数据；此为模板与字段绑定可推导的风险。

### P1 · AA 建议缺少适用条件提示，可能被误认为实际应付款

- **证据**：共享支出区展示“伴侣 AA 垫付对账建议”和复制入口（[分析模板](../../miniprogram/components/tl-tab-analysis/index.wxml#L468-L493)）；计算只取前两名付款人，将付款差额除二，文案称“需向…转账…结清平摊开支”，复制文本称“结清本期公共开支”（[计算](../../miniprogram/components/tl-tab-analysis/dashboard.js#L84-L107)、[复制内容](../../miniprogram/components/tl-tab-analysis/dashboard.js#L124-L132)）。
- **影响**：付款人多于两人、并非全部项目均由两人均摊、消费归属不同或存在既有结算时，数字未必代表真实债务；“需”“结清”表达过于确定。
- **建议**：只有确认两人、共同费用和等额分摊等前提满足时才展示结算金额；否则说明不能据此推算。明确标注估算口径及排除项，避免复制文本断言已结清；业务规则应先经产品确认。
- **边界**：未验证服务端 `family` 的完整构成或产品对 AA 的约定，故不认定每个账本都会产生错误金额。

### P2 · 访客空态展示不可执行的“记一笔”

- **证据**：首页和明细空态无条件展示“记一笔”（[首页](../../miniprogram/components/tl-tab-home/index.wxml#L37-L41)、[明细](../../miniprogram/components/tl-tab-records/index.wxml#L88-L94)）；点击后只读用户被 toast 拦截（[首页](../../miniprogram/components/tl-tab-home/index.js#L452-L456)、[明细](../../miniprogram/components/tl-tab-records/index.js#L414-L418)）。项目规范明确访客无写入操作（[规范](../UI-GUIDELINES.md#L12-L16)）。
- **影响**：对访客呈现无法完成的主操作，增加误触和权限困惑；这不是云端权限绕过的证据。
- **建议**：按只读状态隐藏写入入口，提供明确的只读说明及可执行的浏览操作；检查空账本、当前月份空和筛选为空三类状态。

### P2 · 明细追加失败缺少明确反馈；下钻列表会整体丢失已显示内容

- **证据**：主明细追加失败时仅结束 `loadingMore` 并写日志，不提供错误提示或显式重试（[逻辑](../../miniprogram/components/tl-tab-records/index.js#L292-L317)、[列表底部](../../miniprogram/components/tl-tab-records/index.wxml#L85-L86)）。分析下钻明细的任何请求失败均置 `error: true`（[逻辑](../../miniprogram/pages/record-filtered/index.js#L125-L145)），模板随即以错误态替代整个列表（[模板](../../miniprogram/pages/record-filtered/index.wxml#L7-L25)）。
- **影响**：分页失败时用户可能以为没有更多数据，或为一次追加失败失去当前浏览上下文。
- **建议**：区分首屏与追加失败；追加失败保留已加载记录，在列表末尾显示可重试的错误，继续使用原游标；快照变化则明确说明并安全刷新。
- **边界**：未做断网或滚动触底实测，不排除自动再次触底带来的重试。

### P2 · 明细页自行实现重试与空态按钮

- **证据**：明细页的“重新加载”“记一笔”使用绑定点击的 `view`（[模板](../../miniprogram/components/tl-tab-records/index.wxml#L46-L50)、[空态](../../miniprogram/components/tl-tab-records/index.wxml#L88-L94)），而规范要求复用公共按钮与空状态（[规范](../UI-GUIDELINES.md#L5-L8)）。
- **影响**：样式、交互反馈与公共组件可能漂移，语义和无障碍能力需额外验证。
- **建议**：评估改用 `tl-button` 和公共空态插槽，保留现有层级与暖红体系，不借机改版；检查按压反馈、读屏和触控面积。

### P3 · 大额首页汇总使用近似值却没有近似标识

- **证据**：绝对值达到 100000 时首页以万元为单位保留一位小数（[金额格式](../../miniprogram/components/tl-tab-home/index.js#L17-L20)），并直接显示在本月结余、收入、支出（[首页](../../miniprogram/components/tl-tab-home/index.wxml#L159-L176)）。
- **影响**：四舍五入后的值可能被当作精确财务数字；相比之下分析日历的近似值会带 `≈`（[日历格式](../../miniprogram/components/tl-tab-analysis/dashboard.js#L28-L36)）。
- **建议**：被舍入时标注约数，并确保用户有清晰的精确金额查看路径；先核实现有截断与布局需求。

## 复核与优先顺序

1. 先核实并修复分析错误态、月报口径和 AA 前提；对财务结论应优先保证表达正确，再讨论视觉。
2. 然后处理只读空态及两类分页失败反馈，统一公共按钮；保留已有颜色、卡片与 navbar 语言。
3. 使用测试账本和非生产数据检查：个人/共享、Owner/成员/访客、无账本/空账本/有历史但本月为空；首次加载及二次刷新失败、分页失败、账本与周期快速切换；周/月/年及自定义、收入/支出、多人付款与非均摊。
4. 按 [UI 检查要求](../UI-GUIDELINES.md#L19-L21) 在后续实际修改时运行 `npm run ui:check` 和适用的分析视觉回归，并在开发者工具及真机检查安全区、长文本、大字体、图表读屏、触控热区、对比度与滚动遮挡。静态代码不能证明这些视觉或设备表现合格。

本次仅阅读代码与规范并撰写报告，未修改产品代码，未运行测试或操作真实账务。

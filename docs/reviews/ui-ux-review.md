# 首页、明细与分析页 UI/UX 专项审查

## 范围与方法

- 基于当前工作区代码静态只读审查：首页、明细列表、记录详情、筛选明细和分析页；工作区已有未提交修改，本报告反映审查时的代码快照，不代表已发布版本。除本报告外未修改产品代码。
- 已调用 `ui-ux-pro-max`，本地检索 `icon button accessible label`（icons）、`data chart legend accessibility`（chart）、`loading error empty states`（ux）。图表检索的前两项不适用，采用第三项「Part-to-Whole」：避免仅靠颜色，提供比例文本及列表替代；不将其 Web 代码示例直接套用于微信小程序。
- **证据等级**：下列“代码事实”是静态检查结果；用户影响和复现路径是**推断**，并非设备实测。未运行微信开发者工具、真机、读屏器或网络故障注入；未测对比度、触控尺寸、安全区或动态字号，因此不宣称 WCAG 合规或失败。
- 优先级按对理解与任务完成的潜在影响排序；建议遵循项目现有暖色规范、公共组件及权限边界，不建议改变品牌设计。

## 重点发现

### P1 分析页成功加载后再次请求失败，错误及重试入口可能完全不可见

- **代码事实**：错误占位仅在 `error && !chartFirstReadyEver` 时出现（`miniprogram/components/tl-tab-analysis/index.wxml:59-63`）；主内容在 `error` 时隐藏（同文件 `:67-69`；`miniprogram/components/tl-tab-analysis/index.wxss:42-48`）。成功时将 `chartFirstReadyEver` 设为 true（`miniprogram/components/tl-tab-analysis/index.js:898-912`），后续失败置 `error: true`、清理数据但不重置该标志（同文件 `:970-1014`）。
- **推断及复现路径**：先成功打开分析，再切换周期或账本并使请求失败；可能只剩顶部筛选，既无错误解释也无重试。需在模拟器注入失败核实。
- **建议**：将首屏与后续失败均纳入可见错误状态；明确是否保留旧数据及其所属区间，提供重新加载；添加成功→切换→失败→重试覆盖。

### P1 生活月报的支出文案与当前筛选方向、周期可能不一致

- **代码事实**：周、月、年模式均可打开“生活月报”，且收支筛选独立存在（`miniprogram/components/tl-tab-analysis/index.wxml:3-7,36-40,71-83`）；月报固定标“家庭总支出”，却读取当前 `dashboardView.totalText` 和 `recordCount`（同文件 `:596-610`）；该视图由当前 `request.analysisType` 构建（`miniprogram/components/tl-tab-analysis/index.js:885-897`），复制文本同样固定为“家庭支出”（同文件 `:1091-1114`）。
- **推断及复现路径**：选收入、周度或年度后打开并复制月报，可能将收入或非月度数据描述为家庭月支出；金额语义应结合实际返回再核实。
- **建议**：月报限定月度支出并清晰切换上下文，或动态呈现周期、收支方向及标题；展示和复制共用同一语义模型，覆盖各筛选组合。

### P2 明细分页失败反馈不足，筛选明细则丢失当前列表视图

- **代码事实**：明细列表追加失败仅清除 `loadingMore`，没有错误标志或重试提示（`miniprogram/components/tl-tab-records/index.js:292-317`）；模板仅展示加载中或无更多（`miniprogram/components/tl-tab-records/index.wxml:85-86`）。筛选明细追加失败统一置 `error: true`（`miniprogram/pages/record-filtered/index.js:125-145`），错误分支替换整页列表并只提供整体重新加载（`miniprogram/pages/record-filtered/index.wxml:7-25`）。
- **推断**：弱网下前者可能让人误以为滚动无响应，后者使已读内容暂时不可见、重试回到首页数据。
- **建议**：保留已加载记录，在列表尾显示“加载失败，重试”，仅重试当前游标；独立处理快照变化需要整体刷新的情形。

### P2 图标控件和状态切换的无障碍语义需要验证

- **代码事实**：明细前后月箭头是仅含图标的可点击 `view`（`miniprogram/components/tl-tab-records/index.wxml:5-20`）；分析日期箭头、选中周期和收支筛选亦使用可点击 `view`，未在这些节点声明可访问名称、选中或禁用状态（`miniprogram/components/tl-tab-analysis/index.wxml:3-7,14-27,36-40`）；分析日明细关闭按钮只有图标（同文件 `:208-214`）；底栏中央加号同样无文字（`miniprogram/components/tl-tabbar/index.wxml:10-15`）。
- **推断**：读屏用户可能难以得知按钮用途、当前选项和不可用状态；实际微信无障碍树可能受组件和系统影响，须真机核实，不能仅凭 WXML 判定最终读屏结果。
- **建议**：依据微信小程序支持的无障碍属性为操作提供名称、角色及状态；装饰性图标不重复朗读；按视觉顺序验证焦点、弹层关闭与焦点返回，并实测触控范围。

### P2 趋势及图表替代信息虽存在，但周度对照的数值不完整

- **代码事实**：周趋势以浅深柱区分上周和本周（`miniprogram/components/tl-tab-analysis/index.wxml:168-178`）；展开趋势明细只列 `item.amountText`，未列 `previous` 的对应数值（同文件 `:179-185`）。分类图有名称、金额、占比列表及图表错误重试（同文件 `:247-275`）；自定义走势也有收入、支出、结余明细表（同文件 `:383-419`）。
- **推断**：无法辨色或不能操作柱体的用户，可能无法从文本获得上周逐日对照；绘制图表的实际读屏可达性和颜色对比尚未实测。
- **建议**：周趋势文本逐项列出日期、本周、上周及变化；为图表提供简短摘要和可达的完整明细，并用非颜色标记辅助区分。

### P3 空状态写入入口对只读访客的预期不清

- **代码事实**：首页空状态无条件显示“记一笔”（`miniprogram/components/tl-tab-home/index.wxml:22-41`）；明细空状态也无条件显示（`miniprogram/components/tl-tab-records/index.wxml:88-94`）；两个处理函数均在只读时提示并返回（`miniprogram/components/tl-tab-home/index.js:452-456`；`miniprogram/components/tl-tab-records/index.js:414-421`）。
- **推断**：访客点击可见主要操作才知道不能记账，形成无效尝试；现有处理保护写入，不意味着存在权限绕过。
- **建议**：按权限提供说明和查看历史等替代动作，或以明确语义展示不可用原因；与底栏只读反馈保持一致。

## 已有积极设计

- 首页以单一状态映射加载、无账本、空和错误（`miniprogram/components/tl-tab-home/index.js:33-39,272-276`），无账本提供创建入口（`miniprogram/components/tl-tab-home/index.wxml:17-20`）。
- 记录详情加载和失败有骨架与重试（`miniprogram/pages/record-detail/index.wxml:7-12`），金额含正负号和收支文字（同文件 `:19-22`）；不只依赖颜色。
- 分析分类列表有文字、金额、占比及图表失败备用列表；日明细有加载、错误、重试和分页入口（`miniprogram/components/tl-tab-analysis/index.wxml:216-228,247-275`）。

## 建议验证矩阵

1. 注入首次及成功后的网络失败：分析周期/账本切换、图表初始化、明细首屏及第二页，验证反馈、重试和数据是否对应所选上下文。
2. 周/月/年 × 收入/支出打开并复制生活月报，对照真实账目核验标题、区间、金额及类别。
3. 微信开发者工具及 iOS/Android 真机：开启系统读屏，逐项检查箭头、加号、筛选选中态、图表明细、弹层焦点与关闭；检查大字体、窄屏、横屏、安全区、触控区域及文本对比度。
4. 无账本、空账本、有历史但本月无记录、访客、成员和 Owner 场景逐项检查空状态入口与权限说明；以上均为待测项。

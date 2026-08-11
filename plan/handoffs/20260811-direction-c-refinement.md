# Handoff: Direction C 精修（UI 去 AI 感）

- Status: done
- Date: 2026-08-11
- Scope: renderer 全局视觉 token + 全页面语义色清扫

## 结论

Direction C（纸墨 × 黄铜金）方向不变，做精修而非重做。三处落地：

1. **卡片实底化**：`cardStyles.ts` 的 `CARD_SURFACE_CLASS` 去掉 `bg-bg-card/60 + backdrop-blur-[2px]`；
   Dashboard 内联卡面、`bg-bg-card/<alpha>` 残留（组件与页面共 18 处）、Sidebar 的
   `bg-bg-sidebar/80 backdrop-blur-xl` 全部改实底。纸张噪点保留。
2. **语义色低饱和 token 化**：`tokens.css` 新增 `--status-ok/warn/err/info/purple`
   （浅色 `#4d7a5e/#9a7b3a/#a85546/#5f7390/#7a6f9e`，暗色配套提亮）；
   `tailwind.config.ts` 的 `status.*` 全部映射到 token，`status-red/amber/blue`
   保留为别名（旧类名自动获得新色值）。renderer 内 110 处 Tailwind 默认色板类
   （`text-red-600`、`bg-emerald-50` 等）已替换为 `status-*`，残留 0。
   MetricCard / SegmentedProgress 的 tone hex 改用 `rgb(var(--status-*))`；
   ProviderSummary 8 色分类色板换为低饱和纸墨系。
3. **字阶成文**：`tokens.css` 新增 `--text-display/title/body/label/eyebrow/micro`
   （30/22/13.5/12/9.5/10.5px），作为后续页面的引用基准。

## 证据

- `npm run typecheck` 通过；`npm run lint` 零警告；`npm test` 691 passed / 1 skipped。
- 3 个断言旧设计值的测试已更新（motion-primitives、metric-card、model-usage-card）。
- 高保真预览稿：`.kun-design/component-prototypes/moonmeter-direction-c-277574c3b9/prototype.html`。

## 风险与后续

- `tag.*` Provider 品牌色（#10A37F 等）刻意保留——那是品牌识别而非语义色。
- `--text-*` 字阶变量目前仅成文，未批量替换页面内的散点字号（26px/34px 大数字等），
  如需严格收敛可单独立项。
- 供应商分类色在暗色下未单独校准（沿用浅色值），如暗色对比度不足再调。

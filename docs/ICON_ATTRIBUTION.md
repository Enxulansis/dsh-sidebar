# 图标来源与许可

## 文件格式徽标

`src/file-type-icons.ts` 使用 [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) 5.38.1 的 SVG，采用 MIT 许可，版权声明为 `Copyright (c) 2025 Material Extensions`。

2026-10-29 核验：45 个具名图标及 1 个默认文件图标，解码后的字节均与原始 VSIX 解包素材一致。转换为 base64 内嵌，没有修改 SVG 图形。历史调研目录中的其他候选图标套件不属于这份实际使用清单。

许可原文见 [Material-Icon-Theme-MIT.txt](../licenses/Material-Icon-Theme-MIT.txt)，同时纳入 [THIRD-PARTY-NOTICES.txt](../THIRD-PARTY-NOTICES.txt)。[上游许可证](https://github.com/material-extensions/vscode-material-icon-theme/blob/main/LICENSE)允许使用、修改、发布和分发，要求随副本或实质部分保留版权及许可声明。该要求不要求把整个侧栏改为其他许可证。

README 可以展示这些图标在产品中的实际界面效果，并链接本页说明来源。图标涉及的产品或品牌名称仅用于识别文件类型，不表示获得相关品牌背书。

## 复制按钮和轮次导航

复制按钮及复制后的勾号是 `src/webview.ts` 中的内嵌 SVG（`COPY_SVG`、`CHECK_SVG`）；代码没有单独注明外部图标库来源。不能仅凭图形相似断定来自某一图标库，也不据此断言原创。当前按项目 MIT 源码的来源链保留署名。

轮次导航中的普通节点、停点菱形与收藏金色由同文件 CSS 和节点状态逻辑绘制，不是导入的文件格式图标：`.turn-rail-node`、`.stop`、`.marked`。收藏决定金色，标注与收藏是独立状态。文档展示时应保留这一差别；具体停点含义须结合会话事件，不把所有菱形都描述为普通问题节点。

## 本次补正与发布状态

此前声明生成器仅扫描打包依赖，遗漏直接嵌入源码的 Material Icon Theme 图标。本次在本地补入许可全文，并更新生成器，避免重新生成声明时再次遗漏。

这份核验不替代所有品牌资源的完整来源审查，也不将 DeepSeek 标志归入 Material Icon Theme。当前已发布的旧附件不会因本地修改自动更新；下一次发布须同步附带补正后的声明与许可文件。

# Swift Club · 进化线路图

[English](README.md) · **简体中文**

**在线访问：<https://et-link.github.io/swift-club/?lang=zh>**（英文版：<https://et-link.github.io/swift-club/>）

Swift 6.0 → 6.4（2024.09 – 2026.09）两年新特性的互动学习站，做成了一张地铁线路图：

- **6 条主题线路** × **5 个版本“票价区”**，共 80 个特性站
- **上车前（5.x）**：8 个基础站，讲 `async`/`await`、任务、actor、`@MainActor`、`Sendable` 和续体（Swift 5.5 – 5.10），按 Swift 6 语言模式来教。它们在并发线上排在 6.0 之前，不计入新特性
- 每一站：一句话讲清楚、新旧代码对比、**真实的编译器输出**、部分配有小测
- **3 个实验室**：并发执行轨迹（nonisolated / nonsending / @concurrent）、所有权沙盒（~Copyable）、内存布局（Array / InlineArray / Span）
- **编译器猜猜看**：17 段代码，标准答案由编译器给出
- **提案总表**：6.0 以来全部 156 个 Swift Evolution 提案，可按版本、线路筛选，并预告 6.5
- **通行卡**：打卡进度（只存在本机浏览器）
- **默认英文，中文可选**：用顶栏的 EN / 中文 切换

## 打开

直接用浏览器打开 `index.html` 即可，不需要服务器。字体从 Google Fonts 加载，离线时会退回系统字体。

`dist/swift-club.html` 是把 CSS、JS 和所有语言的数据全部内联后的单文件版本，用于发布。它省略了 `<html>`、`<head>` 这类外壳（发布平台会自动补上），所以本地请打开 `index.html`。

## 语言

默认语言是英文，中文是可选语言。

- 选择语言的顺序：URL 里的 `?lang=`（例如 `?lang=zh`），其次是这个浏览器里保存的选择，最后是英文。
- 顶栏的语言开关会就地切换，并同步更新 URL，所以复制出来的链接会用同一种语言打开。
- 每种语言是 `content/` 下的一个文件夹，里面放它自己的课程、实验室、挑战题和界面文字。[`content/languages.json`](content/languages.json) 列出所有语言，并指明默认语言。
- 构建会为每种语言生成一个数据包（`assets/data.<lang>.js`）。默认语言随页面一起加载，其他语言在选中时才下载。
- 构建还会检查各语言保持同步：特性、代码块、小测结构、编译器结论和界面文字的键都要一致。没有标记 `"cjk": true` 的语言里如果出现中文，构建会报错，用来发现漏译。

添加一种语言：把 `content/en/` 复制成 `content/<代码>/`，翻译里面的 Markdown、`site.json` 和 `ui.json`（代码示例里的注释和字符串也要翻译，构建会重新编译），再到 `content/languages.json` 里登记。

## 真实编译

页面上的每一段 Swift 代码都不是手写的“示意输出”：构建脚本会把它交给本机的 `swiftc` 编译或运行，然后把诊断和输出原样嵌进页面。期望报错的代码必须真的报错，期望通过的必须真的通过，否则构建失败。

当前数据由 `Apple Swift version 6.4.2` 生成。

## 目录

```
content/
  languages.json           语言列表，以及默认语言
  en/  zh/                 每种语言一个文件夹
    5.x.md                   “上车前”基础区（在 site.json 里标记为 `"prelude": true`）
    6.0.md … 6.4.md          各版本的特性（Markdown 风格的自定义格式）
    challenges.md            编译器猜猜看
    labs.md                  实验室用到的代码与步骤
    site.json                线路、版本、快线
    ui.json                  界面文字
src/page.html              页面骨架
assets/
  style.css                样式
  app.js                   页面逻辑（路由、Swift 高亮、线路图、实验室、多语言……无依赖）
  data.en.js  data.zh.js   构建生成的数据，每种语言一个
tools/
  build.mjs                构建脚本
  evolution-snapshot.json  Swift Evolution 提案索引快照（6.0+），外加课程里引用的少数更早的提案
dist/swift-club.html       单文件发布版，内联了所有语言
```

## 修改内容后重新构建

```bash
node tools/build.mjs            # 编译并校验全部示例（有缓存，改动的部分才重新编译）
node tools/build.mjs --fresh    # 忽略缓存，全部重新编译
node tools/build.mjs --no-compile   # 不调用 swiftc，只用缓存
```

需要 Node 18+ 和 Swift 工具链；带 `testing` 属性的示例需要 macOS 上的 Xcode（用来链接 Swift Testing / XCTest）。

编译缓存 `tools/.compile-cache.json` 也提交在仓库里。只改文字、没动代码块时，没装 Swift 的机器也能用 `--no-compile` 重新生成页面。

代码块写法示例：

````markdown
```swift title="Swift 6 模式会报错" check=error flags="-swift-version 6"
...
```
````

| 属性 | 含义 |
| --- | --- |
| `check=ok` / `error` / `warning` / `run` / `none` | 必须通过 / 必须报错 / 必须有警告 / 编译并运行 / 不编译 |
| `flags="…"` | swiftc 参数，默认 `-swift-version 6` |
| `script` | 作为 `main.swift` 顶层代码编译（`run` 自动启用） |
| `testing` | 链接 Swift Testing 和 XCTest |
| `expect="…"` | 诊断或输出中必须出现的文字 |
| `hl="2,5-7"` | 高亮行 |

## 发布（GitHub Pages）

Pages 设置为从 `main` 分支的根目录发布。根目录的 `.nojekyll` 让 Pages 跳过 Jekyll，把文件原样发布出去，否则 `content/` 里带 `---` 元数据的 `.md` 会被当成页面处理。

更新线上版本：在本机重新构建，把生成的 `assets/data.*.js`、`index.html`、`dist/swift-club.html` 和改动一起提交并推送，一两分钟后生效。GitHub Pages 允许浏览器把每个文件缓存 10 分钟，所以 `index.html` 引用每个文件时都带上内容指纹（`assets/app.js?v=…`）：新版本上线后，普通刷新就能看到。

没有用 GitHub Actions 在云端构建，是因为构建要调用 `swiftc`：换一个 Swift 版本，页面上的编译输出可能就变了。

## 数据来源

- 提案与版本归属：[Swift Evolution 官方索引](https://www.swift.org/swift-evolution/)
- 各版本要点：swift.org 的 Swift 6.1、6.2、6.3、6.4 发布说明，以及 Swift 6 发布公告

Swift 及 Swift 标志是 Apple Inc. 的商标。本项目是非官方学习资料。

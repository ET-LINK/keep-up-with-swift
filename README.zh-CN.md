# Swift Club

[English](README.md) · **简体中文**

Swift 6.0–6.4 新特性的互动学习站，做成了一张地铁线路图：<https://et-link.github.io/swift-club/?lang=zh>

每一站讲一个特性，新旧代码并排对照，附真实的编译器输出。此外还有三个实验室、编译器猜猜看小游戏、Swift Evolution 提案总表，以及一节简短的 Swift 5.x 并发入门。

## 打开

用浏览器直接打开 `index.html`，不需要服务器。

## 构建

构建时，每段 Swift 代码都会交给本机的 `swiftc` 编译或运行，输出原样嵌入页面。预期报错的代码如果能编译通过（或者反过来），构建会失败。

```bash
node tools/build.mjs                # 重新构建，只重新编译改动过的代码
node tools/build.mjs --fresh        # 忽略缓存
node tools/build.mjs --no-compile   # 只用缓存，不调用 swiftc
```

需要 Node 18+ 和 Swift 工具链（macOS 上，带 Swift Testing 的示例还需要 Xcode）。编译缓存 `tools/.compile-cache.json` 也提交在仓库里，所以只改文字、没动代码块时，没装 Swift 也能用 `--no-compile` 构建。

代码块的属性（`check=error`、`flags="…"`、`expect="…"` 等）写在 `tools/build.mjs` 开头的注释里。

## 目录

```
content/<语言>/   课程（5.x.md … 6.4.md）、实验室、挑战题、site.json、ui.json
src/page.html     页面骨架
assets/           style.css、app.js，以及生成的 data.<语言>.js
tools/            build.mjs、Swift Evolution 快照、编译缓存
dist/             单文件发布版；本地请打开 index.html
```

`index.html`、`assets/data.*.js` 和 `dist/swift-club.html` 由构建生成，不要手改。

## 发布

GitHub Pages 从 `main` 分支的根目录发布。重新构建后，把生成的文件连同改动一起提交并推送，一两分钟后生效。`.nojekyll` 让 Pages 跳过 Jekyll，不去处理 `content/` 里的 Markdown。

不在 CI 里构建，因为编译器输出取决于 Swift 版本。

## 数据来源

提案及其所属版本来自 [Swift Evolution 索引](https://www.swift.org/swift-evolution/)，各版本要点来自 swift.org 的 Swift 6.x 发布说明。非官方项目；Swift 是 Apple Inc. 的商标。

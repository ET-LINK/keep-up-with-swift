# 编译器猜猜看
# 每道题的标准答案不是人写的：构建脚本会把代码交给 swiftc 真实编译，
# 用编译器的实际结果（ok / warning / error）作为答案。expect 只用来校验出题人的预期。

## ch-detached
title: 把计数器交给后台任务，然后自己也改一下
topic: Swift 6 语言模式
related: swift6-mode
expect: error
explain: 非 `Sendable` 的 `counter` 被交给了 `Task.detached`，之后当前线程又访问了它。两处访问可能同时发生，这就是数据竞争。Swift 6 模式下这是**编译错误**。

```swift
final class Counter { var value = 0 }

func race() {
    let counter = Counter()
    Task.detached { counter.value += 1 }
    counter.value += 1
}
```

## ch-region
title: 新建一个对象交给后台任务，之后再也不碰
topic: 区域隔离
related: region-sending
expect: ok
explain: 区域隔离（SE-0414）能证明 `log` 所在的区域被整体交了出去，之后没有任何访问，所以即使 `Log` 不是 `Sendable` 也能**安全编译**。

```swift
final class Log { var lines: [String] = [] }

func start() {
    let log = Log()
    log.lines.append("启动")
    Task.detached { log.lines.append("后台") }
}
```

## ch-static-var
title: 一个普通的静态变量
topic: 全局可变状态
related: swift6-mode
expect: error
explain: "`static var` 是任何线程都能读写的全局可变状态。Swift 6 模式要求你用 `let`、全局 actor（如 `@MainActor`）或 `nonisolated(unsafe)` 说明它如何保证安全。"

```swift
struct AppConfig {
    static var shared = AppConfig()
    var debug = false
}
```

## ch-typed-throws
title: 类型化抛出，catch 里不写兜底
topic: 类型化抛出
related: typed-throws
expect: ok
explain: 因为函数声明了 `throws(NetworkError)`，`catch` 里的 `error` 静态类型就是 `NetworkError`，`switch` 覆盖了全部两个 case，完全合法，也不需要额外的 `catch` 分支。

```swift
enum NetworkError: Error { case offline, timeout }

func ping() throws(NetworkError) { throw .timeout }

func check() {
    do {
        try ping()
    } catch {
        switch error {
        case .offline: print("离线")
        case .timeout: print("超时")
        }
    }
}
```

## ch-consume-twice
title: 不可复制的值，用了两次
topic: ~Copyable
related: noncopyable-generics
expect: error
explain: "`seal()` 是 `consuming` 的：第一次调用就把 `envelope` 的所有权拿走了。第二次调用时它已经不存在，编译器会报“consumed more than once”。"

```swift
struct Envelope: ~Copyable {
    consuming func seal() {}
}

func send() {
    let envelope = Envelope()
    envelope.seal()
    envelope.seal()
}
```

## ch-inline-append
title: 往 InlineArray 里追加一个元素
topic: InlineArray
related: inlinearray
expect: error
explain: "`InlineArray` 的长度是类型的一部分（这里是 3），它根本没有 `append` 方法。需要可变长度，请用 `Array` 或 6.4 的 `UniqueArray`。"

```swift
func grow() {
    var rgb: [3 of UInt8] = [255, 128, 0]
    rgb.append(64)
}
```

## ch-trailing-call
title: 函数调用的最后一个实参后面多一个逗号
topic: 尾随逗号
related: trailing-commas
expect: ok
explain: Swift 6.1（SE-0439）起，形参列表、实参列表、元组、泛型参数列表和捕获列表都允许尾随逗号。

```swift
func greet(_ name: String, times: Int) -> String {
    String(repeating: "你好，\(name)！", count: times)
}

let text = greet(
    "Swift",
    times: 2,
)
```

## ch-trailing-if
title: if 条件列表末尾多一个逗号
topic: 尾随逗号
related: trailing-commas
expect: error
explain: 条件列表是 SE-0439 明确排除的例外：`if a, b, {` 中最后的逗号会让编译器把 `{` 当成下一个条件的开始，所以依然是语法错误。

```swift
func check(_ a: Bool, _ b: Bool) {
    if a, b, {
        print("都成立")
    }
}
```

## ch-weak-let
title: Sendable 类里放一个 weak let
topic: weak let
related: weak-let
expect: ok
explain: Swift 6.3 起 `weak let` 是合法的不可变弱引用。它不能被重新赋值，所以不会引起数据竞争，类可以安全地声明为 `Sendable`。如果写成 `weak var`，就会报错。

```swift
final class Comment: Sendable {
    weak let replyTo: Comment?
    init(replyTo: Comment?) { self.replyTo = replyTo }
}
```

## ch-mainactor-eq
title: 主 actor 类直接遵循 Equatable
topic: 隔离一致性
related: isolated-conformances
expect: error
explain: "`Equatable` 的 `==` 是非隔离的要求，而这个类的 `==` 被推断为主 actor 隔离，二者不匹配。修法是写成 `@MainActor Equatable`（SE-0470），或者开启 `InferIsolatedConformances` 让编译器自动推断。"

```swift
@MainActor
final class Song: Equatable {
    var title = ""
    static func == (a: Song, b: Song) -> Bool { a.title == b.title }
}
```

## ch-nonsending
title: 开启 NonisolatedNonsendingByDefault 后，主 actor 调用非 Sendable 对象的异步方法
topic: nonisolated(nonsending)
related: nonsending
flags: -swift-version 6 -enable-upcoming-feature NonisolatedNonsendingByDefault
expect: ok
explain: 开启后，`Store.save()` 在调用者（主 actor）上运行，`store` 没有跨越任何隔离边界，所以**编译通过**。如果去掉这个 upcoming feature，同样的代码会报 “sending 'self.store' risks causing data races”。

```swift
final class Store {
    var saved = 0
    func save() async { saved += 1 }
}

@MainActor
final class Screen {
    let store = Store()
    func tap() async { await store.save() }
}
```

## ch-interp
title: 用 ?? 给 Int? 一个字符串默认值
topic: 字符串插值默认值
related: interp-default
expect: error
explain: 两边类型必须一致：`??` 左边是 `Int?`，右边却是字符串，所以报错。Swift 6.2 的写法是 ``"\(age, default: "未知")"``，默认值可以是任意类型的文字。

```swift
func describe(_ age: Int?) -> String {
    "年龄：\(age ?? "未知")"
}
```

## ch-raw-id
title: 以数字开头的枚举 case
topic: 原始标识符
related: raw-identifiers
expect: ok
explain: Swift 6.2（SE-0451）的原始标识符允许反引号里出现空格、标点，也可以以数字开头。使用时同样要加反引号：`` Resolution.`4K` ``。

```swift
enum Resolution {
    case `720p`, `1080p`, `4K`
}

let best = Resolution.`4K`
```

## ch-task-unused
title: 创建一个会抛错的 Task，但不保存它
topic: Task 警告
related: task-unused
expect: warning
explain: Swift 6.4（SE-0520）会对“会抛错、但返回值没人使用”的非结构化任务发出**警告**：里面的错误会被悄悄吞掉。可以在任务内部处理错误，或者写 `_ = Task { … }` 明确丢弃。

```swift
struct SyncError: Error {}
func sync() async throws { throw SyncError() }

func onLaunch() {
    Task { try await sync() }
}
```

## ch-defer-await
title: 在同步函数的 defer 里 await
topic: async defer
related: async-defer
expect: error
explain: 6.4 允许 `defer` 里出现 `await`，前提是所在的函数本身是 `async` 的。同步函数无法挂起，所以这里依然是错误。

```swift
func flush() async {}

func close() {
    defer { await flush() }
    print("关闭")
}
```

## ch-some-optional
title: 返回 some Shape?，不加括号
topic: some P?
related: optional-some
expect: ok
explain: Swift 6.4（SE-0521）起，`some P?` 等价于 `(some P)?`，`any P?` 等价于 `(any P)?`。

```swift
protocol Shape {}
struct Dot: Shape {}

func maybeShape(_ show: Bool) -> some Shape? {
    show ? Dot() : nil
}
```

## ch-diagnose
title: 在 @diagnose(…, as: ignored) 里调用废弃 API
topic: "@diagnose"
related: diagnose
expect: ok
explain: "`@diagnose(DeprecatedDeclaration, as: ignored)` 让这个函数范围内的“已废弃”警告完全静音，所以既没有错误也没有警告。"

```swift
@available(*, deprecated)
func legacy() {}

@diagnose(DeprecatedDeclaration, as: ignored)
func bridge() {
    legacy()
}
```

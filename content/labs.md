# 实验室数据
# 每段代码都会被真实编译，实验室界面展示的“编译器结论”来自这里。
# steps 的格式：车道 | 代码里的标记 | 说明
#   车道 main = 主 actor，pool = 全局并发线程池，out = 离开主 actor，in = 回到主 actor，wait = 挂起等待

## concurrency-classic
title: 旧规则（6.0 / 6.1 默认）
note: "`nonisolated async` 函数总是跑到全局并发线程池上。"
flags: -swift-version 6
expect: error
steps:
  main | ① | 在主 actor 上执行 `name = "加载中…"`
  out  | ② | 调用 `api.fetch()`：它是 `nonisolated async`，按旧规则**离开主 actor**，切换到全局并发线程池
  pool | ③ | `download()` 也在线程池上发起；等待网络时挂起，不占用线程
  pool | ④ | `parse(raw)` 在线程池上执行
  in   | ⑤ | 结果返回，**切回**主 actor
  main | ⑤ | `name = result`

```swift
final class APIClient {
    func fetch() async -> String {
        let raw = await download()        // ③
        return parse(raw)                 // ④
    }
    func download() async -> [UInt8] { Array("Swift".utf8) }
    func parse(_ raw: [UInt8]) -> String { String(decoding: raw, as: UTF8.self) }
}

@MainActor
final class ProfileModel {
    var name = ""
    let api = APIClient()

    func refresh() async {
        name = "加载中…"                   // ①
        let result = await api.fetch()    // ②
        name = result                     // ⑤
    }
}
```

## concurrency-nonsending
title: 新规则：nonsending（6.2 起）
note: 开启 `NonisolatedNonsendingByDefault` 后，异步函数默认在调用者的 actor 上运行。
flags: -swift-version 6 -enable-upcoming-feature NonisolatedNonsendingByDefault
expect: ok
steps:
  main | ① | 在主 actor 上执行 `name = "加载中…"`
  main | ② | 调用 `api.fetch()`：nonsending，**留在主 actor**，没有线程切换
  wait | ③ | `download()` 在主 actor 上发起；等待网络时挂起，主线程空闲，可以继续响应界面
  main | ④ | `parse(raw)` 在主 actor 上执行。如果解析很耗时，会卡住界面！
  main | ⑤ | `name = result`

```swift
final class APIClient {
    func fetch() async -> String {
        let raw = await download()        // ③
        return parse(raw)                 // ④
    }
    func download() async -> [UInt8] { Array("Swift".utf8) }
    func parse(_ raw: [UInt8]) -> String { String(decoding: raw, as: UTF8.self) }
}

@MainActor
final class ProfileModel {
    var name = ""
    let api = APIClient()

    func refresh() async {
        name = "加载中…"                   // ①
        let result = await api.fetch()    // ②
        name = result                     // ⑤
    }
}
```

## concurrency-concurrent
title: 新规则 + @concurrent
note: 默认留在原地，只把真正耗时的 `parse` 显式交给线程池。
flags: -swift-version 6 -enable-upcoming-feature NonisolatedNonsendingByDefault
expect: ok
steps:
  main | ① | 在主 actor 上执行 `name = "加载中…"`
  main | ② | 调用 `api.fetch()`：nonsending，留在主 actor
  wait | ③ | `download()` 挂起等待网络，主线程空闲
  out  | ④ | `parse` 标了 `@concurrent`：**显式**切换到全局并发线程池
  pool | ④ | 在线程池上解析，主线程完全不受影响
  in   | ④ | 解析完成，回到主 actor 上的 `fetch()`
  main | ⑤ | `name = result`

```swift
final class APIClient {
    func fetch() async -> String {
        let raw = await download()          // ③
        return await Self.parse(raw)        // ④
    }
    func download() async -> [UInt8] { Array("Swift".utf8) }

    @concurrent
    static func parse(_ raw: [UInt8]) async -> String {
        String(decoding: raw, as: UTF8.self)
    }
}

@MainActor
final class ProfileModel {
    var name = ""
    let api = APIClient()

    func refresh() async {
        name = "加载中…"                     // ①
        let result = await api.fetch()      // ②
        name = result                       // ⑤
    }
}
```

## ownership-move
title: 移动之后再使用
expect: error

```swift
struct Ticket: ~Copyable {
    let id: Int
    consuming func punch() {}
}
func inspect(_ t: borrowing Ticket) {}

func demo() {
    let a = Ticket(id: 1)
    let b = a
    inspect(a)
    inspect(b)
}
```

## ownership-twice
title: 消耗两次
expect: error

```swift
struct Ticket: ~Copyable {
    let id: Int
    consuming func punch() {}
}

func demo() {
    let a = Ticket(id: 1)
    a.punch()
    a.punch()
}
```

## ownership-copy
title: 试图复制
expect: error

```swift
struct Ticket: ~Copyable {
    let id: Int
}

func demo() {
    let a = Ticket(id: 1)
    let c = copy a
    _ = c
}
```

## ownership-ok
title: 正确的用法
expect: ok

```swift
struct Ticket: ~Copyable {
    let id: Int
    consuming func punch() {}
}
func inspect(_ t: borrowing Ticket) {}

func demo() {
    let a = Ticket(id: 1)
    inspect(a)
    let b = a
    inspect(b)
    b.punch()
}
```

## memory-table
title: 真实的内存布局数据
note: 由 Swift 6.4.2 在 arm64 上运行得到。

```swift check=run
func inline<T>(_: T.Type) -> [Int] {
    [MemoryLayout<[1 of T]>.size, MemoryLayout<[2 of T]>.size, MemoryLayout<[3 of T]>.size,
     MemoryLayout<[4 of T]>.size, MemoryLayout<[5 of T]>.size, MemoryLayout<[6 of T]>.size,
     MemoryLayout<[7 of T]>.size, MemoryLayout<[8 of T]>.size]
}

func row<T>(_ name: String, _ t: T.Type) -> String {
    """
    {"name":"\(name)","size":\(MemoryLayout<T>.size),"stride":\(MemoryLayout<T>.stride),\
    "align":\(MemoryLayout<T>.alignment),"inline":\(inline(t)),"array":\(MemoryLayout<[T]>.size),\
    "span":\(MemoryLayout<Span<T>>.size)}
    """
}

let rows = [
    row("UInt8", UInt8.self),
    row("Int16", Int16.self),
    row("Int32", Int32.self),
    row("Int", Int.self),
    row("Double", Double.self),
    row("Bool", Bool.self),
    row("(Int, Bool)", (Int, Bool).self),
    row("SIMD4<Float>", SIMD4<Float>.self),
]
print("[" + rows.joined(separator: ",") + "]")
```

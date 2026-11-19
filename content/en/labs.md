# Lab data
# Every snippet is really compiled; the "compiler verdicts" shown in the lab pages come from here.
# cmp: one-line summary shown in the comparison cards under the concurrency lab
# steps format: lane | marker in the code | explanation
#   lane: main = main actor, pool = global concurrent pool, out = leaves the main actor, in = returns to the main actor, wait = suspended

## concurrency-classic
title: Old rule (default in 6.0 / 6.1)
note: "A `nonisolated async` function always hops to the global concurrent pool."
cmp: A non-Sendable `api` gets carried over to another thread
flags: -swift-version 6
expect: error
steps:
  main | ① | Runs `name = "Loading…"` on the main actor
  out  | ② | Calls `api.fetch()`: it is `nonisolated async`, so under the old rule it **leaves the main actor** and hops to the global concurrent pool
  pool | ③ | `download()` also starts on the pool; while it waits for the network it suspends and holds no thread
  pool | ④ | `parse(raw)` runs on the pool
  in   | ⑤ | The result comes back and execution **hops back** to the main actor
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
        name = "Loading…"                 // ①
        let result = await api.fetch()    // ②
        name = result                     // ⑤
    }
}
```

## concurrency-nonsending
title: New rule: nonsending (from 6.2)
note: With `NonisolatedNonsendingByDefault` on, async functions run on the caller's actor by default.
cmp: Stays on the main actor throughout, but `parse` occupies the main thread
flags: -swift-version 6 -enable-upcoming-feature NonisolatedNonsendingByDefault
expect: ok
steps:
  main | ① | Runs `name = "Loading…"` on the main actor
  main | ② | Calls `api.fetch()`: nonsending, so it **stays on the main actor** with no thread hop
  wait | ③ | `download()` starts on the main actor; while it waits for the network it suspends, the main thread is free, and the UI stays responsive
  main | ④ | `parse(raw)` runs on the main actor. If parsing is slow, it freezes the UI!
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
        name = "Loading…"                 // ①
        let result = await api.fetch()    // ②
        name = result                     // ⑤
    }
}
```

## concurrency-concurrent
title: New rule + @concurrent
note: Stay put by default; only the genuinely expensive `parse` is explicitly handed to the pool.
cmp: Only the expensive `parse` is explicitly sent to the background
flags: -swift-version 6 -enable-upcoming-feature NonisolatedNonsendingByDefault
expect: ok
steps:
  main | ① | Runs `name = "Loading…"` on the main actor
  main | ② | Calls `api.fetch()`: nonsending, stays on the main actor
  wait | ③ | `download()` suspends while it waits for the network; the main thread is free
  out  | ④ | `parse` is marked `@concurrent`: it **explicitly** hops to the global concurrent pool
  pool | ④ | Parses on the pool; the main thread is completely unaffected
  in   | ④ | Parsing finishes and execution returns to `fetch()` on the main actor
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
        name = "Loading…"                   // ①
        let result = await api.fetch()      // ②
        name = result                       // ⑤
    }
}
```

## ownership-move
title: Using it after a move
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
title: Consuming twice
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
title: Trying to copy
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
title: Correct usage
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
title: Real memory layout data
note: Produced by Swift 6.4.2 running on arm64.

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

# Guess the Compiler
# The answer to each challenge is not written by hand: the build script hands the code to swiftc,
# and the compiler's actual result (ok / warning / error) is the answer. `expect` only checks the author's expectation.

## ch-detached
title: Hand the counter to a background task, then modify it yourself too
topic: Swift 6 language mode
related: swift6-mode
expect: error
explain: The non-`Sendable` `counter` is handed to `Task.detached`, and then the current thread touches it again. The two accesses can happen at the same time, which is a data race. In Swift 6 mode that is a **compile error**.

```swift
final class Counter { var value = 0 }

func race() {
    let counter = Counter()
    Task.detached { counter.value += 1 }
    counter.value += 1
}
```

## ch-region
title: Create an object, hand it to a background task, and never touch it again
topic: Region-based isolation
related: region-sending
expect: ok
explain: Region-based isolation (SE-0414) can prove that the whole region containing `log` was handed off and is never accessed afterwards, so even though `Log` is not `Sendable`, this **compiles safely**.

```swift
final class Log { var lines: [String] = [] }

func start() {
    let log = Log()
    log.lines.append("start")
    Task.detached { log.lines.append("background") }
}
```

## ch-static-var
title: An ordinary static variable
topic: Global mutable state
related: swift6-mode
expect: error
explain: "`static var` is global mutable state that any thread can read and write. Swift 6 mode asks you to say how it is kept safe: with `let`, with a global actor such as `@MainActor`, or with `nonisolated(unsafe)`."

```swift
struct AppConfig {
    static var shared = AppConfig()
    var debug = false
}
```

## ch-typed-throws
title: Typed throws, with no catch-all in the catch
topic: Typed throws
related: typed-throws
expect: ok
explain: Because the function declares `throws(NetworkError)`, the static type of `error` in the `catch` is `NetworkError`, and the `switch` covers both cases. That is perfectly legal and needs no extra `catch` branch.

```swift
enum NetworkError: Error { case offline, timeout }

func ping() throws(NetworkError) { throw .timeout }

func check() {
    do {
        try ping()
    } catch {
        switch error {
        case .offline: print("offline")
        case .timeout: print("timeout")
        }
    }
}
```

## ch-consume-twice
title: Using a noncopyable value twice
topic: ~Copyable
related: noncopyable-generics
expect: error
explain: "`seal()` is `consuming`: the first call takes ownership of `envelope`. By the second call it no longer exists, and the compiler reports “consumed more than once”."

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
title: Appending an element to an InlineArray
topic: InlineArray
related: inlinearray
expect: error
explain: "An `InlineArray`'s length is part of its type (3 here), so it simply has no `append` method. If you need a variable length, use `Array` or 6.4's `UniqueArray`."

```swift
func grow() {
    var rgb: [3 of UInt8] = [255, 128, 0]
    rgb.append(64)
}
```

## ch-trailing-call
title: A comma after the last argument of a function call
topic: Trailing commas
related: trailing-commas
expect: ok
explain: Since Swift 6.1 (SE-0439), parameter lists, argument lists, tuples, generic parameter lists, and capture lists all allow a trailing comma.

```swift
func greet(_ name: String, times: Int) -> String {
    String(repeating: "Hello, \(name)! ", count: times)
}

let text = greet(
    "Swift",
    times: 2,
)
```

## ch-trailing-if
title: A comma at the end of an if condition list
topic: Trailing commas
related: trailing-commas
expect: error
explain: Condition lists are the exception SE-0439 explicitly excludes: the last comma in `if a, b, {` makes the compiler treat `{` as the start of another condition, so it is still a syntax error.

```swift
func check(_ a: Bool, _ b: Bool) {
    if a, b, {
        print("both true")
    }
}
```

## ch-weak-let
title: A weak let in a Sendable class
topic: weak let
related: weak-let
expect: ok
explain: Since Swift 6.3, `weak let` is a legal immutable weak reference. It cannot be reassigned, so it cannot cause a data race, and the class can safely be `Sendable`. With `weak var` you would get an error.

```swift
final class Comment: Sendable {
    weak let replyTo: Comment?
    init(replyTo: Comment?) { self.replyTo = replyTo }
}
```

## ch-mainactor-eq
title: A main-actor class conforming directly to Equatable
topic: Isolated conformances
related: isolated-conformances
expect: error
explain: "`Equatable`'s `==` is a nonisolated requirement, while this class's `==` is inferred to be main-actor isolated, so the two do not match. The fix is to write `@MainActor Equatable` (SE-0470), or to turn on `InferIsolatedConformances` so the compiler infers it."

```swift
@MainActor
final class Song: Equatable {
    var title = ""
    static func == (a: Song, b: Song) -> Bool { a.title == b.title }
}
```

## ch-nonsending
title: Main actor calling an async method on a non-Sendable object, with NonisolatedNonsendingByDefault on
topic: nonisolated(nonsending)
related: nonsending
flags: -swift-version 6 -enable-upcoming-feature NonisolatedNonsendingByDefault
expect: ok
explain: With it on, `Store.save()` runs on the caller (the main actor) and `store` never crosses an isolation boundary, so it **compiles**. Without this upcoming feature, the same code reports “sending 'self.store' risks causing data races”.

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
title: Using ?? to give an Int? a string default
topic: String interpolation defaults
related: interp-default
expect: error
explain: Both sides must have the same type. The left of `??` is `Int?` but the right is a string, hence the error. The Swift 6.2 way is ``"\(age, default: "unknown")"``, where the default can be a literal of any type.

```swift
func describe(_ age: Int?) -> String {
    "Age: \(age ?? "unknown")"
}
```

## ch-raw-id
title: An enum case that starts with a digit
topic: Raw identifiers
related: raw-identifiers
expect: ok
explain: Raw identifiers in Swift 6.2 (SE-0451) allow spaces and punctuation inside backticks, and even a leading digit. You use them with backticks too: `` Resolution.`4K` ``.

```swift
enum Resolution {
    case `720p`, `1080p`, `4K`
}

let best = Resolution.`4K`
```

## ch-task-unused
title: Creating a throwing Task but not keeping it
topic: Task warnings
related: task-unused
expect: warning
explain: Swift 6.4 (SE-0520) emits a **warning** for an unstructured task that can throw but whose result nobody uses, because the error is silently swallowed. Handle the error inside the task, or write `_ = Task { … }` to discard it explicitly.

```swift
struct SyncError: Error {}
func sync() async throws { throw SyncError() }

func onLaunch() {
    Task { try await sync() }
}
```

## ch-defer-await
title: await inside a defer in a synchronous function
topic: async defer
related: async-defer
expect: error
explain: 6.4 allows `await` inside `defer` as long as the enclosing function is itself `async`. A synchronous function cannot suspend, so this is still an error.

```swift
func flush() async {}

func close() {
    defer { await flush() }
    print("closing")
}
```

## ch-some-optional
title: Returning some Shape? without parentheses
topic: some P?
related: optional-some
expect: ok
explain: From Swift 6.4 (SE-0521), `some P?` is equivalent to `(some P)?`, and `any P?` is equivalent to `(any P)?`.

```swift
protocol Shape {}
struct Dot: Shape {}

func maybeShape(_ show: Bool) -> some Shape? {
    show ? Dot() : nil
}
```

## ch-diagnose
title: Calling a deprecated API inside @diagnose(…, as: ignored)
topic: "@diagnose"
related: diagnose
expect: ok
explain: "`@diagnose(DeprecatedDeclaration, as: ignored)` silences the “deprecated” warning inside this function entirely, so there is neither an error nor a warning."

```swift
@available(*, deprecated)
func legacy() {}

@diagnose(DeprecatedDeclaration, as: ignored)
func bridge() {
    legacy()
}
```

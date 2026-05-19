# Session Registry

Gateway-side session mapping storage lives here.

Initial mapping:

```text
session_id -> server_instance_id
```

The first prototype can use in-memory storage. Durable storage can come later.

Prototype implementation:

- [`memory-session-registry.js`](memory-session-registry.js)
- [`file-session-registry.js`](file-session-registry.js)
- [`redis-session-registry.js`](redis-session-registry.js)

Current contract:

- `assign(sessionId, serverInstanceId, metadata?)`
- `get(sessionId)`
- `delete(sessionId)`
- `deleteByServer(serverInstanceId)`
- `list()`
- `markDisconnected(sessionId, { gracePeriodMs })`
- `markReconnected(sessionId)`
- `isExpired(sessionId)`
- `isWithinGrace(sessionId)`
- `pruneExpired()`
- `clear()`

The gateway now treats these methods as promise-compatible. Existing in-memory
and file registries remain synchronous, and async-backed registries such as
Redis can also be used because the gateway awaits the same contract.

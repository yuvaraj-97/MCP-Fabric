# Session Registry

Gateway-side session mapping storage lives here.

Initial mapping:

```text
session_id -> server_instance_id
```

The first prototype can use in-memory storage. Durable storage can come later.

Prototype implementation:

- [`memory-session-registry.js`](memory-session-registry.js)

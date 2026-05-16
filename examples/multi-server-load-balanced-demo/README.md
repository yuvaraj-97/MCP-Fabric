# Multi-Server Load-Balanced Demo

End-to-end demo for session affinity and load-aware assignment across multiple
server instances.

Run:

```sh
node examples/multi-server-load-balanced-demo/server.js
```

Then open:

```text
http://127.0.0.1:3001/inspector
```

The inspector shows:

- generated or resumed `sessionId`
- routed `serverInstanceId`
- ordered SSE events
- current gateway session mappings

Local load test:

```sh
node examples/multi-server-load-balanced-demo/load-generator.js http://127.0.0.1:3001 25 100
```

Live-domain load test:

```sh
node examples/multi-server-load-balanced-demo/load-generator.js https://core-tensor.com 25 100
```

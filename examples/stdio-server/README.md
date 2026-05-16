# stdio Server Example

Example MCP-compatible server running through the stdio transport adapter.

Run:

```sh
node examples/stdio-server/server.js
```

Send newline-delimited JSON requests such as:

```json
{"id":1,"method":"initialize","params":{"clientId":"local-cli"}}
{"id":2,"method":"echo","sessionId":"<session-id>","params":{"message":"hello"}}
```

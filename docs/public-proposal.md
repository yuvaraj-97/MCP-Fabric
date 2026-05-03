# Public Proposal Draft

## Title

Session-Aware, Transport-Agnostic Infrastructure for MCP

## Summary

This project proposes an optional infrastructure layer for MCP-compatible
deployments. It preserves MCP's existing protocol semantics while adding
session-aware routing, load-aware assignment, and transport-neutral application
interfaces for deployments that need to scale beyond a single stdio process.

## Motivation

MCP works well as a protocol abstraction, but production HTTP/SSE deployments can
run into infrastructure concerns that are outside the core protocol:

- long-lived streams need continuity
- reconnects need to land on the right server instance
- overloaded instances should stop receiving new sessions
- application logic should not be rewritten for each transport

## Proposal

Add a compatible infrastructure layer:

```text
MCP application logic
MCP protocol semantics
Session-aware routing
Transport adapters
Gateway and runtime infrastructure
```

The protocol remains MCP. The added layer improves deployment behavior.

## Compatibility

The project should remain compatible with MCP clients and servers. Any
experimental behavior should be explicitly marked and isolated from the core
compatibility path.

## Open Questions

- Which runtime should the first prototype target?
- Should the gateway be a library, a standalone process, or both?
- How should session restoration work after an instance crash?
- Which parts belong in upstream MCP discussions and which should remain
  external infrastructure?

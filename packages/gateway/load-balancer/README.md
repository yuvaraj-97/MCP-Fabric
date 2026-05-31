# Load Balancer

Gateway-side load-aware assignment lives here.

Initial policy:

- route existing sessions by registry mapping
- assign new sessions to the least-loaded healthy instance
- stop assigning new sessions to instances above the configured threshold
- honor explicit Phase 1 runtime modes:
  - `sticky` keeps existing healthy sessions on the registered instance
  - `stateless` bypasses existing affinity and selects a healthy instance for
    each request

Prototype implementation:

- [`load-router.js`](load-router.js)

# Load Balancer

Gateway-side load-aware assignment lives here.

Initial policy:

- route existing sessions by registry mapping
- assign new sessions to the least-loaded healthy instance
- stop assigning new sessions to instances above the configured threshold

Prototype implementation:

- [`load-router.js`](load-router.js)

# Load-Aware Routing

Session-aware routing should distinguish existing sessions from new sessions.

## Policy

```text
New sessions       -> least-loaded healthy server
Existing sessions  -> same server as before
Server over limit  -> stop assigning new sessions
Server unhealthy   -> reconnect / reinitialize / migrate
```

The initial research brief uses 70% load as an example threshold. This project
should treat that number as configuration, not protocol behavior.

## Server State

A gateway needs lightweight health and load data for each server instance:

| Field | Meaning |
| --- | --- |
| `server_instance_id` | Stable identity for the running process. |
| `healthy` | Whether the instance can serve traffic. |
| `load` | Current load score, initially a normalized percentage. |
| `accepting_new_sessions` | Whether the instance can receive new sessions. |

## Assignment Algorithm

The first implementation can be intentionally simple:

1. Filter to healthy instances.
2. Filter out instances over the new-session load threshold.
3. Select the lowest-load instance.
4. Store `session_id -> server_instance_id`.

Existing sessions should bypass the new-session threshold as long as their
assigned server is healthy.

## Failure Behavior

If the assigned server becomes unhealthy, the gateway should choose one of the
following behaviors:

- require the client to reinitialize
- restore session state from external storage
- migrate only stateless sessions

The prototype should make this behavior explicit rather than hiding it.

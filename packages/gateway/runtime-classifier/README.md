# Runtime Classifier

Recommendation-only runtime classification lives here.

Phase 2 behavior:

- analyze declared runtime hints and observable request facts
- recommend `stateless` or `sticky`
- emit reasons, scores, and confidence
- never change routing or placement
- report when an explicit runtime mode differs from the recommendation

Supported hints:

```json
{
  "streaming": true,
  "resourceHandles": ["browser"],
  "replaySafe": false,
  "externalState": true,
  "readOnly": true,
  "runtimeDurationMs": 30000,
  "initializationCostMs": 5000
}
```

The gateway accepts hints on `runtimeHints` or `params.runtimeHints`.
Malformed hints are ignored for classification and reported in
`signals.invalidHints`; they do not fail the gateway request.

Prototype implementation:

- [`runtime-classifier.js`](runtime-classifier.js)

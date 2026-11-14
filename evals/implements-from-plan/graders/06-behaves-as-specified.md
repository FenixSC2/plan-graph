---
type: llm
focus: trace
weight: 1
---

Run independently, the CLI matches the plan on spot checks: get of a missing key exits 1 with "no such key" on stderr and nothing on stdout; set with an invalid key exits 2; an unknown command exits 2; list --json prints valid JSON with sorted keys; KV_FILE selects the store file

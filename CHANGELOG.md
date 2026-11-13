# Changelog

## 0.1.0 (2026-11-13)

- The **Kadmo API** credential: an API token and the app's base URL, tested with `GET /api/v1/me`.
- The **Kadmo** node: Job › Dispatch and Get; Task › Create, Get and Run Playbook. Workspaces, workflows and playbooks from lists; a workflow's inputs as fields; Simplify; usable as an AI tool; an automatic `Idempotency-Key` on every create; `429` waited out.
- The **Kadmo Trigger** node: Job Finished, Job Needs Input and Task Done. Subscribes on publish and unsubscribes on unpublish; verifies each delivery's signature and timestamp.

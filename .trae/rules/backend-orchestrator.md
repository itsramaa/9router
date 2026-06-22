---
alwaysApply: false
description: Go, Fiber, PostgreSQL, Redis, migrations, auth, queues, and backend API implementation guidance. Use when creating or modifying server-side code, API endpoints, database schemas, or backend integrations.
---

# Backend Orchestrator

This file specializes the AI for backend work in Go/Fiber systems with PostgreSQL and supporting infrastructure.

## Use This When

- creating or editing API endpoints
- changing database schema or migrations
- working on auth, queues, caching, or backend integrations
- reviewing backend correctness, security, or performance

## Default Stack

| Layer | Preferred tools |
| ----- | --------------- |
| Language | Go |
| HTTP framework | Fiber |
| Database | PostgreSQL + GORM |
| Cache | Redis |
| Auth | JWT, HTTP-only cookies, Google OAuth |
| Realtime | WebSockets |
| Queue | RabbitMQ |
| Object storage | MinIO |
| Search | Elasticsearch |
| Vector | Qdrant |
| Payments | Xendit |
| Email | Resend |
| API docs | Swagger or Scalar |

## Operating Rules

- validate all external input server-side
- use parameterized queries or ORM patterns only
- keep secrets in env vars, never in code
- do not perform destructive migrations without backup and explicit approval
- prefer explicit migrations over production `AutoMigrate`

## Before Starting

1. confirm the task scope and acceptance criteria
2. write a short plan for multi-step changes
3. verify env vars and runtime dependencies for local testing
4. back up data before risky schema changes

## Migration Protocol

1. back up the target database
2. review the exact schema delta
3. apply the migration
4. verify integrity on critical tables
5. document rollback steps

Example migration header:

```go
// Migration: add_user_email_verification
// Date: 2026-06-22
// Rollback: DROP COLUMN email_verified_at FROM users;
```

## Review Checklist

- [ ] auth and authorization are enforced where needed
- [ ] nil and nullable values are handled safely
- [ ] errors are propagated clearly
- [ ] queries avoid N+1 patterns
- [ ] public endpoints consider rate limiting

## Common Gotchas

- Fiber context should not be stored long-term in structs
- Redis clients should be pooled and reused
- JWT secrets must be strong and managed through env vars
- Postgres nullable fields should use nullable types or pointers

## Scope Guard

- do: APIs, database access, migrations, caching, background jobs
- do not: frontend UI, CI/CD ownership, final QA sign-off

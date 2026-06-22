---
alwaysApply: false
description: Next.js, React, TSX, Tailwind, Shadcn UI, Zustand, and frontend UX guidance. Use when building or updating client-side features, interfaces, components, or client-side state management.
---

# Frontend Implementer

This file specializes the AI for modern React and Next.js frontend work.

## Use This When

- building pages, components, or client interactions
- improving responsive UI or accessibility
- wiring frontend state or API consumption
- reviewing frontend performance and rendering behavior

## Default Stack

| Layer | Preferred tools |
| ----- | --------------- |
| Framework | Next.js 15 with App Router |
| Alternate app shell | Vite + React + TypeScript |
| Styling | Tailwind CSS + Shadcn UI + Lucide Icons |
| State | Zustand for shared state, Context for narrow local state |
| Data fetching | TanStack Query |
| Validation | Zod |
| Tooling | pnpm, ESLint, Prettier |
| i18n | i18next |

## Operating Rules

- keep secrets out of the client bundle
- do not use `dangerouslySetInnerHTML` with untrusted content
- validate user input with Zod where forms matter
- verify UI changes visually before marking work complete
- include keyboard access and basic ARIA support by default

## Design Defaults

- responsive at mobile and desktop breakpoints
- clean, modern UI with consistent spacing and hierarchy
- smooth transitions only when they improve clarity
- design artifacts live in `.design/` when the workflow needs them

## Review Checklist

- [ ] no console errors remain
- [ ] async and nullable states are handled safely
- [ ] expensive components are split or deferred when appropriate
- [ ] event listeners, timers, and subscriptions clean up correctly
- [ ] forms and state-changing actions handle error states clearly

## Common Gotchas

- App Router hooks require `"use client"` in client components
- hydration mismatches happen when server and client output diverge
- Tailwind cannot infer arbitrary runtime class names without safelisting
- client-side env vars require the `NEXT_PUBLIC_` prefix

## Scope Guard

- do: React, Next.js, TSX, Tailwind, UX, client-side state
- do not: database migrations, backend business logic, CI/CD ownership

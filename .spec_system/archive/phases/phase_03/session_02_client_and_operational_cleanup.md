# Session 02: Client and operational cleanup

**Session ID**: `phase03-session02-client-and-operational-cleanup`
**Status**: Not Started
**Estimated Tasks**: ~12-18
**Estimated Duration**: 2-4 hours

---

## Objective

Reduce browser-side abuse and operational leakage by bounding stored client state, tightening polling and fallback behavior, and making risky operator actions explicit.

---

## Scope

### In Scope (MVP)

- Add retention or size limits to browser-side stored state
- Deduplicate or bound recurring client-side polling and monitoring behavior
- Remove risky logging, fallback, or reconnaissance-heavy client and route behavior
- Add explicit confirmations for destructive or high-risk operator actions
- Finish any remaining closeout-safe security header tightening

### Out of Scope

- Runtime persistence fixes reserved for Session 01
- Final validation and docs reconciliation reserved for Session 03
- New dashboard feature work unrelated to the audit backlog

---

## Prerequisites

- [ ] Session 01 completed or any shared helper changes needed by the client work are available
- [ ] Open P03 client and operational findings have been mapped to concrete targets

---

## Deliverables

1. Bounded client-state retention for the remaining local storage surfaces
2. Hardened polling, fallback, and operator-action behavior on the client side
3. Reduced browser-visible operational metadata and safer operator affordances

---

## Success Criteria

- [ ] Client storage no longer grows indefinitely without pruning or expiry
- [ ] Repeated client-side monitors are bounded, deduplicated, or backoff-aware
- [ ] High-risk operator actions require clear intentional confirmation

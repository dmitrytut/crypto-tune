# Bubble and Drop Collisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Falling sell drops bounce off other drops and rising buy bubbles bounce off other bubbles, without changing market data.

**Architecture:** A browser-independent collision solver resolves overlapping circles in place, with mass proportional to radius squared and mostly elastic normal impulses. Slow non-separating overlaps receive a small artistic separation kick. One solver instance reuses frozen sweep bounds across separate drop and bubble scratch lists, avoiding missed pairs when contact corrections reorder live coordinates. Fx advances both groups in steps no larger than 1/120 s before drawing, storing sway in the actual collision velocity, retaining pops, floor impacts and reduced-motion clearing. The groups do not collide with each other.

**Tech Stack:** Existing TypeScript, Canvas 2D, Vitest, Vite; no new dependencies.

**Spec:** Approved simple-bounce description in this conversation; implementation choices below are the assistant's defaults.

## Global Constraints

- Develop on the isolated `feat/drop-collisions-work3` branch, based on `master`.
- Falling sell drops collide with drops; rising buy bubbles collide with bubbles. Cross-side contacts, spray droplets and sparks are excluded.
- No merging, deformation, physics library, new settings, audio or feed changes.
- Mass is proportional to circle area. Separate overlap without adding energy to already separating contacts; coincident centres must remain finite.
- Preserve the 1,500 live-particle cap, floor impacts, buy pops and reduced-motion clearing.
- All UI copy and repository documentation are English.

## Review Focus

- Coincident centres: deterministic finite separation, covered by collision spec.
- Separating overlaps: position correction without another bounce, covered by collision spec.
- Unequal sizes and glancing contacts: area-weighted impulse, conserved momentum and unchanged tangential motion, covered by collision specs.
- Dense bursts / long frames: bounded substeps and capped-population browser smoke and timing probe.
- Lifecycle: floor impacts, buy pops, clearing and reduced motion remain functional, covered by real Fx browser smoke.

---

### Task 1: Implement and integrate damped particle contacts

**Files:**
- Create: `src/ui/scene/collisions.ts`
- Create: `src/ui/scene/__specs__/collisions.spec.ts`
- Modify: `src/ui/scene/fx.ts`
- Modify: `README.md`

**Interfaces:**
- `CollisionBody`: mutable `x`, `y`, `vx`, `vy`, `r` numbers, owned by `collisions.ts`, package-private export.
- `CollisionSolver.resolve(bodies: CollisionBody[]): void`: sorts one particle group's scratch list and mutates positions and velocities. The instance retains only a reusable buffer of original sweep bounds; membership and particle radii remain unchanged.
- Existing `Fx` API and all callers remain unchanged.

- [x] Write behavioral specs for head-on separation with energy loss, unequal-area mass, tangential velocity, separating overlaps, coincident centres, and non-contact circles with overlapping horizontal bounds.
- [x] Run `pnpm test src/ui/scene/__specs__/collisions.spec.ts`; confirm missing implementation fails.
- [x] Implement sorted horizontal broad phase, exact circle contact, area-weighted position separation and restitution 0.75. Approaching contacts rebound at no less than 32 px/s; zero relative speed receives a kick only when overlapping. Already separating contacts receive no added impulse.
- [x] Integrate using reused separate drop and bubble scratch lists and substeps <= 1/120 s. Extract movement before drawing, keep the frame-time cap and buoyant sway; damp horizontal particle velocity after impact.
- [x] Run the specific spec and `pnpm check && pnpm test && pnpm build`.
- [x] Start a dedicated Vite dev server. Exercise actual Fx in the browser: controlled contacts within each group, no cross-side contacts, landing, popping, clear, reduced motion and capped dense traffic; inspect the rendered canvas.
- [x] Update README with the behavior and verification commands after smoke proof. Remove all temporary smoke artifacts from the worktree; leave the dev server running for the user.
- [x] Extend contacts to buy bubbles after the user's follow-up approval. A browser probe fails before the extension and passes after it for opposing bubbles; a separate check confirms a faster bubble deflects one above it.
- [x] Strengthen repulsion after the user's visual feedback: include sway in collision velocity and give slow overlaps visible separation. Regression specs fail before and pass after the change; a real Fx probe shows a gap over 5 px after 250 ms for both groups and confirms rebound under opposing sway.
- [x] Review cleanup: reuse `BubbleStart` for live particle motion fields, give the shared solver neutral names, and freeze sweep bounds before positional correction. The four-circle missed-contact regression fails before the fix and passes afterward.

Review the complete change for correctness, cleanliness and reuse before committing and opening a pull request against `master`.

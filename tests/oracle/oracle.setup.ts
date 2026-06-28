/**
 * FROZEN setup for the verifier-owned panel oracle. Do NOT weaken, edit, or bypass.
 *
 * This file is FROZEN for the /goal run — `verifier-integrity` in scripts/verify.mjs FAILs if it
 * changes against the `observatory-verifier-baseline` tag. The frozen `vitest.oracle.config.ts`
 * loads THIS file as its ONLY setup (never the mutable `tests/setup.ts`), so the loop cannot
 * inject a `vi.mock('@/App', …)` (or any other global hook) into the oracle's process to make a
 * stubbed/hidden AppShell satisfy the gate. The oracle only needs jest-dom's matcher registration;
 * it deliberately does NOT register any module mock, timer fake, or global override.
 */
import '@testing-library/jest-dom';

# PromptGuard Core Migration Plan

## Stage 1. Scaffold `packages/core`
Goal: create a reusable package boundary without changing extension behavior.

Files:
- `packages/core/package.json`
- `packages/core/tsconfig.json`
- `packages/core/src/index.ts`
- `packages/core/src/{parser,analyzer,optimizer,tokenizer,costing,security,governance,analytics,types}/index.ts`

Reasoning:
- Establishes the future single source of truth for reusable prompt intelligence.
- Keeps the VS Code extension untouched while the new package is introduced.

Tests/verification:
- `npm run compile`
- `npm run typecheck`
- `git status --short`

Compatibility:
- No runtime wiring changes.
- No command, setting, or UI changes.
- Existing extension entrypoint remains `src/extension.ts`.

## Stage 2. Move pure contracts and parser primitives
Goal: move data-only types and prompt AST parsing into `packages/core`.

Files likely to move:
- `src/analysis/promptAst.ts`
- `src/analysis/promptAstParser.ts`
- `src/analysis/rule.ts`
- `src/scoring/promptScorer.ts`
- supporting shared types from `src/types/index.ts`

Reasoning:
- These are data-first and have no VS Code dependency.
- They are the safest first logic extraction and become the base for all later modules.

Tests/verification:
- Existing parser and rule tests
- `npm run typecheck`
- `npm run compile`

Compatibility:
- Preserve public shapes and behavior.
- Extension imports can be temporarily re-exported through compatibility shims if needed.

## Stage 3. Move analysis and optimization engines
Goal: move reusable analysis and rewrite logic into core.

Files likely to move:
- `src/analysis/promptAnalyzer.ts`
- `src/analysis/localPromptAdvisor.ts`
- `src/heuristics/rules.ts`
- `src/cost/costEstimator.ts`
- `src/improver/optimizationPipeline.ts`
- `src/improver/promptOptimizer.ts`
- `src/improver/promptCompressionEngine.ts`
- `src/services/context/promptContextOptimizerService.ts`
- `src/services/deadCode/promptDeadCodeEliminationService.ts`
- `src/services/duplicates/promptDuplicateDetectionService.ts`
- `src/services/tokenProfiler.ts`
- `src/services/analytics/promptAnalyticsService.ts`

Reasoning:
- These are the core business rules of PromptGuard and should be callable from extension, CLI, proxy, or SDK later.
- Keep algorithms intact; only move boundaries and dependency injection.

Tests/verification:
- Analyzer, optimizer, profiler, and analytics tests
- `npm run typecheck`
- `npm run compile`
- targeted unit tests for the moved modules

Compatibility:
- Preserve the current diagnostics, scores, and optimization output.
- Keep extension-facing command names and UI behavior stable.

## Stage 4. Move governance and storage-aware services behind adapters
Goal: isolate reusable policy, budget, benchmark, handoff, learning, and provider logic.

Files likely to move:
- `src/services/policy/promptPolicyService.ts`
- `src/services/policy/promptPolicyPackService.ts`
- `src/services/budget/promptBudgetService.ts`
- `src/services/benchmarks/promptBenchmarkService.ts`
- `src/services/handoff/promptHandoffService.ts`
- `src/services/learning/promptLearningService.ts`
- `src/services/providers/promptProviderCatalogService.ts`
- `src/services/providers/promptProviderRegistryService.ts`
- `src/services/audit/promptAuditExportService.ts`

Reasoning:
- These are reusable governance primitives but still need storage adapters at the extension layer.
- File IO and workspace-root resolution should become injected adapters, not hard-coded assumptions.

Tests/verification:
- Policy, budget, handoff, provider, audit, benchmark, and learning tests
- `npm run typecheck`
- `npm run compile`

Compatibility:
- Preserve file formats, command behavior, and exported reports.
- Keep workspace paths and defaults unchanged.

## Stage 5. Slim the VS Code extension to orchestration only
Goal: turn the extension into a presentation shell over core APIs.

Files likely to update:
- `src/extension.ts`
- `src/chat/promptGuardParticipant.ts`
- `src/services/lint/promptLintService.ts`
- `src/commands/registerCodeActions.ts`
- UI/webview files if their data contracts need adjustment

Reasoning:
- At this point the extension should mostly wire inputs/outputs and render results.
- This is where `packages/core` becomes the single source of truth.

Tests/verification:
- Full extension compile/typecheck
- Existing end-to-end behavior checks
- Manual smoke test of the main commands

Compatibility:
- Preserve commands, settings, and UI text unless a pure data shape change forces a small adapter.

## Stage 6. Introduce compatibility exports and workspace wiring
Goal: let the extension depend on core without breaking existing imports.

Files likely to add/update:
- root workspace package metadata if needed
- extension import paths
- possible barrel exports in `packages/core`

Reasoning:
- Makes the core package consumable by future CLI/proxy/SDK layers.
- Allows incremental migration without a flag day.

Tests/verification:
- `npm run compile`
- `npm run typecheck`
- package-level build for `packages/core`

Compatibility:
- No behavior changes.
- Extension remains the same externally.

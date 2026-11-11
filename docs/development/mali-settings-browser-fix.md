# Settings import and Mali browser branding

`/settings` imports `settings.component.tsx` → `UserDetailDto` → `MediaDto`.
PR #89 added `@Type(() => ImageUserTag)` to `MediaDto.user_tags`.
`class-transformer` reads `Reflect.getMetadata` while evaluating that decorator;
loading the polyfill in a sibling component such as `Sets` is too late when this
import runs first. `media.dto.ts` now loads `reflect-metadata` itself, before any
decorator executes. Validation rules and transformations are unchanged.

The regression `media.import.spec.ts` starts with `Reflect.getMetadata` absent,
imports the same settings DTO graph, and checks both user and nested tag validation.
Run from the repository root:

```sh
pnpm exec jest --config libraries/nestjs-libraries/jest.config.ts --runInBand --runTestsByPath libraries/nestjs-libraries/src/dtos/media/media.import.spec.ts libraries/nestjs-libraries/src/dtos/media/media.dto.spec.ts
pnpm exec jest --config apps/frontend/jest.config.ts --runInBand --runTestsByPath apps/frontend/src/components/ui/brand-logo.metadata.jest.spec.ts
pnpm --filter ./apps/frontend run build
```

Mali assets are local under `apps/frontend/public/branding`, sourced from
https://grupomali.com.br:

- `mali-icon.svg`: `/assets/mali-8efd40c3a85c.svg` (M mark).
- `mali-apple-touch-icon.png`: `/assets/mali-7db9a22afc8c.png`.
- `mali-logo.webp`: `/_astro/mali-logo.OG1t1RNJ_ZdEBSq.webp` (320 × 112 wordmark).

The SVG was inspected as XML: no scripts, event handlers, embedded images, foreign
objects, external references or CSS URL references. The local wordmark and M are
the defaults, including while the branding request loads. A configured wordmark
can still override the default. The instance named Mali Posts uses M for the
compact logo and tab icon. Other brands with a configured logo retain that logo
as their tab icon. All three layouts include M and the Apple icon in the initial HTML.

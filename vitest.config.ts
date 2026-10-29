import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    /* live-* = 需真实 dsh（spawn）或真网的场景（L3 层）：默认套件（L1）排除，
       用 vitest.live.config.ts 跑。删掉这行会让 L1 拖进真机 spawn。 */
    exclude: [...configDefaults.exclude, 'tests/live-*.spec.ts'],
  },
})

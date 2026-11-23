// The component store e2e runs on its own, against a scratch PIVOT (see README.md): never part of `pnpm test`.
export default {
  test: {
    root: import.meta.dirname,
    include: ["component-store.e2e.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
};

// The workflow demo runs on its own, against a scratch PIVOT (see README.md): never part of `pnpm test`.
export default {
  test: {
    root: import.meta.dirname,
    include: ["workflow.e2e.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
};

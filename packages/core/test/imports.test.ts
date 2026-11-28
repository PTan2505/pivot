// The npm packages a component's code imports (packages/core/src/imports.ts): the preview build installs them when the
// saved list leaves them out, and save_component names them.
import { describe, expect, it } from "vitest";
import { importedPackages, missingDependencies, packageOf } from "../src/imports";

describe("reading the imports", () => {
  it("names the package behind each kind of specifier, scoped ones and subpaths included", () => {
    expect(packageOf("motion/react")).toBe("motion");
    expect(packageOf("@radix-ui/react-slot")).toBe("@radix-ui/react-slot");
    expect(packageOf("@react-three/fiber/native")).toBe("@react-three/fiber");
    expect(packageOf("lucide-react")).toBe("lucide-react");
  });

  it("leaves out relative, aliased, built-in and URL imports", () => {
    for (const spec of [
      "./x",
      "../y",
      "/abs",
      "@/lib/utils",
      "~/z",
      "#internal",
      "node:fs",
      "fs",
      "path",
      "https://esm.sh/react",
    ])
      expect(packageOf(spec), spec).toBeNull();
  });

  it("finds runtime imports in script files only, once each, and skips type-only ones", () => {
    const files = [
      {
        path: "components/ui/card.tsx",
        code: `"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import * as THREE from "three";
import "@fontsource/inter";
import type { Props } from "some-types-only";
export { Slot } from "@radix-ui/react-slot";
export type { X } from "types-elsewhere";
import { cn } from "@/lib/utils";
const lazy = () => import("canvas-confetti");
const old = require("clsx");
import {
  a,
  b,
} from "multi-line-pkg";`,
      },
      { path: "README.md", code: 'import x from "not-code"' },
      { path: "demo.tsx", code: 'import { motion } from "motion/react";' },
    ];
    expect(importedPackages(files)).toEqual([
      "react",
      "motion",
      "three",
      "@fontsource/inter",
      "@radix-ui/react-slot",
      "canvas-confetti",
      "clsx",
      "multi-line-pkg",
    ]);
    expect(missingDependencies(files, [{ name: "three" }])).toEqual([
      "motion",
      "@fontsource/inter",
      "@radix-ui/react-slot",
      "canvas-confetti",
      "clsx",
      "multi-line-pkg",
    ]);
  });
});

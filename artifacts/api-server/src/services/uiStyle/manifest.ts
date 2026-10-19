import type { UiStyleFramework } from "@workspace/db";
import { validName } from "./validate.js";

/**
 * What a project is built with, read from its manifests (0042).
 *
 * File markers decide this, not `repositories.stack_profile`: the stack
 * detector reports `frontend: "react"` for ANY repository containing a
 * package.json, including a pure Node backend, and has no value at all for
 * Next, Svelte, Solid or Razor. A dependency list is the honest signal.
 */

const UI_FRAMEWORKS: Array<[string, string]> = [
  ["next", "next"],
  ["nuxt", "nuxt"],
  ["@angular/core", "angular"],
  ["svelte", "svelte"],
  ["solid-js", "solid"],
  ["vue", "vue"],
  ["react", "react"],
];

const STYLING: Array<[string, string]> = [
  ["tailwindcss", "tailwindcss"],
  ["@mui/material", "MUI"],
  ["@chakra-ui/react", "Chakra UI"],
  ["antd", "Ant Design"],
  ["@mantine/core", "Mantine"],
  ["styled-components", "styled-components"],
  ["@emotion/react", "Emotion"],
  ["sass", "Sass/SCSS"],
  ["bootstrap", "Bootstrap"],
  ["@angular/material", "Angular Material"],
];

export interface ManifestInfo {
  framework: UiStyleFramework;
  /** True when this manifest indicates a UI, used for root candidacy. */
  isUi: boolean;
  iconLibrary: string | null;
  classHelper: string | null;
  primitives: string[];
  warnings: string[];
}

const ICONS: Array<[string, string]> = [
  ["lucide-react", "lucide-react"],
  ["@heroicons/react", "@heroicons/react"],
  ["@mui/icons-material", "@mui/icons-material"],
  ["react-icons", "react-icons"],
  ["@fortawesome/react-fontawesome", "fontawesome"],
  ["lucide-vue-next", "lucide-vue-next"],
];

const PRIMITIVES: Array<[string, string]> = [
  ["@radix-ui/react-dialog", "radix"],
  ["@headlessui/react", "headlessui"],
  ["react-hook-form", "react-hook-form"],
  ["@tanstack/react-table", "@tanstack/react-table"],
  ["sonner", "sonner"],
];

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  // pnpm's catalog: and workspace: protocols name a resolution, not a version.
  if (/^(catalog|workspace|link|file):/.test(v)) return null;
  return v.replace(/^[\^~>=<\s]+/, "") || null;
};

/**
 * Read one package.json. Never throws — a malformed manifest yields "no UI
 * here" and a warning, because a broken file in one workspace package must
 * not stop the others being considered.
 */
export function readPackageManifest(file: string, text: string): ManifestInfo {
  const empty: ManifestInfo = {
    framework: { ui: null, styling: [] },
    isUi: false,
    iconLibrary: null,
    classHelper: null,
    primitives: [],
    warnings: [],
  };

  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(text) as typeof pkg;
  } catch {
    return { ...empty, warnings: [`${file}: not valid JSON, skipped`] };
  }

  const deps: Record<string, string> = { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
  const has = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);

  const uiEntry = UI_FRAMEWORKS.find(([dep]) => has(dep));
  const styling = STYLING.filter(([dep]) => has(dep)).map(([dep, label]) => ({
    name: label,
    version: clean(deps[dep]),
  }));

  const icon = ICONS.find(([dep]) => has(dep))?.[1] ?? null;
  const helper = has("tailwind-merge")
    ? "tailwind-merge"
    : has("clsx")
      ? "clsx"
      : has("classnames")
        ? "classnames"
        : null;

  return {
    framework: {
      ui: uiEntry ? uiEntry[1] : null,
      uiVersion: uiEntry ? clean(deps[uiEntry[0]]) : null,
      styling,
    },
    isUi: Boolean(uiEntry),
    iconLibrary: icon ? validName(icon) : null,
    classHelper: helper,
    primitives: PRIMITIVES.filter(([dep]) => has(dep)).map(([, label]) => label),
    warnings: [],
  };
}

/** shadcn/ui's marker file, which also names the aliases it generated with. */
export function readComponentsJson(text: string): { componentLib: string; aliases: Record<string, string> } | null {
  try {
    const parsed = JSON.parse(text) as { aliases?: Record<string, string> };
    return { componentLib: "shadcn/ui", aliases: parsed.aliases ?? {} };
  } catch {
    return null;
  }
}

/**
 * Path aliases from a tsconfig, so a component's import specifier is the one
 * app code actually writes ("@/components/ui/button", not a relative path).
 *
 * tsconfig.json is JSONC in practice — comments and trailing commas are
 * common — so the comment strip is deliberate, not sloppiness.
 */
export function readTsconfigAliases(text: string): Record<string, string> {
  try {
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    const parsed = JSON.parse(stripped) as {
      compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
    };
    const paths = parsed.compilerOptions?.paths ?? {};
    const out: Record<string, string> = {};
    for (const [alias, targets] of Object.entries(paths)) {
      const target = Array.isArray(targets) ? targets[0] : undefined;
      if (typeof target === "string") out[alias] = target;
    }
    return out;
  } catch {
    return {};
  }
}

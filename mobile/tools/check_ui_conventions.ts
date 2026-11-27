/**
 * Static checks for the UI conventions in docs/ui_conventions.md. Exits non-zero on any
 * violation, printing file:line, the rule id, and the fix.
 *
 *   npm run check:ui
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const MOBILE = join(__dirname, '..');
const APP = join(MOBILE, 'app');
const SRC = join(MOBILE, 'src');

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? listFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

function reactNativeImports(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'react-native'/g)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

const violations: Violation[] = [];
const report = (file: string, line: number, rule: string, message: string) =>
  violations.push({ file: relative(MOBILE, file).split(sep).join('/'), line, rule, message });

const appFiles = listFiles(APP);
const srcFiles = listFiles(SRC);
const screenFiles = appFiles.filter((file) => !file.endsWith('_layout.tsx'));

const SCROLL_COMPONENTS = ['ScrollView', 'FlatList', 'SectionList', 'KeyboardAvoidingView', 'VirtualizedList'];
const TOUCHABLES = ['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback', 'Button', 'Switch'];

for (const file of [...appFiles, ...srcFiles]) {
  const source = readFileSync(file, 'utf8');
  const imports = reactNativeImports(source);
  const isLayoutModule = file === join(SRC, 'ui', 'screen_layout.tsx');
  const isControlsModule = file === join(SRC, 'ui', 'controls.tsx');
  const inApp = file.startsWith(APP + sep);

  // R1: one scroll container.
  for (const name of SCROLL_COMPONENTS) {
    if (imports.has(name) && !isLayoutModule) {
      report(file, lineOf(source, source.indexOf(name)), 'R1', `${name} imported; use ScreenScrollView from src/ui/screen_layout.tsx`);
    }
  }
  // R2: no Link-wrapped children.
  for (const match of source.matchAll(/\basChild\b/g)) {
    report(file, lineOf(source, match.index ?? 0), 'R2', 'Link asChild drops row styles; use NavigationRow, PressableCard or ActionButton');
  }
  if (inApp && /import\s*\{[^}]*\bLink\b[^}]*\}\s*from\s*'expo-router'/.test(source)) {
    report(file, lineOf(source, source.indexOf('Link')), 'R2', "Link imported in a screen; navigate with NavigationRow/ActionButton href");
  }
  // R4: TextInput only inside FormField.
  if (imports.has('TextInput') && !isControlsModule) {
    report(file, lineOf(source, source.indexOf('TextInput')), 'R4', 'TextInput imported; use FormField from src/ui/controls.tsx');
  }
  if (inApp) {
    // R5: no hand-made horizontal rows in screens.
    for (const match of source.matchAll(/ui\.row\b|flexDirection:\s*'row'/g)) {
      report(file, lineOf(source, match.index ?? 0), 'R5', 'Horizontal row in a screen; use LabelValueRow, TableRow, ChipGroup or Stepper');
    }
    // R6: no raw touchables in screens.
    for (const name of TOUCHABLES) {
      if (imports.has(name)) {
        report(file, lineOf(source, source.indexOf(name)), 'R6', `${name} imported in a screen; use the controls in src/ui/controls.tsx`);
      }
    }
  }
}

// R3: every route file is registered with a title, and every registration has a file.
const rootLayout = readFileSync(join(APP, '_layout.tsx'), 'utf8');
const tabsLayout = readFileSync(join(APP, '(tabs)', '_layout.tsx'), 'utf8');
const registered = (layout: string) =>
  new Set([...layout.matchAll(/\.Screen\s+name="([^"]+)"[^>]*options=\{\{[^}]*title:/g)].map((m) => m[1] as string));
const rootNames = registered(rootLayout);
const tabNames = registered(tabsLayout);
const rootGroups = new Set([...rootLayout.matchAll(/\.Screen\s+name="(\([^)]+\))"/g)].map((m) => m[1] as string));
const routeNames = new Set<string>();
for (const file of screenFiles) {
  const route = relative(APP, file).split(sep).join('/').replace(/\.tsx?$/, '');
  if (route.startsWith('(tabs)/')) {
    const name = route.slice('(tabs)/'.length);
    routeNames.add(`(tabs)/${name}`);
    if (!tabNames.has(name)) report(file, 1, 'R3', `Tab route "${name}" is not registered with a title in app/(tabs)/_layout.tsx`);
  } else {
    routeNames.add(route);
    if (!rootNames.has(route)) report(file, 1, 'R3', `Route "${route}" is not registered with a title in app/_layout.tsx`);
  }
}
for (const name of rootNames) {
  if (!routeNames.has(name) && !rootGroups.has(name)) report(join(APP, '_layout.tsx'), 1, 'R3', `Registered route "${name}" has no file`);
}
for (const name of tabNames) {
  if (!routeNames.has(`(tabs)/${name}`)) report(join(APP, '(tabs)', '_layout.tsx'), 1, 'R3', `Registered tab "${name}" has no file`);
}

// R7: every screen renders through the shared screen layout.
for (const file of screenFiles) {
  const source = readFileSync(file, 'utf8');
  if (!/ScreenScrollView|ScreenMessage|MilestonePlaceholder|PassphraseSetupForm/.test(source)) {
    report(file, 1, 'R7', 'Screen does not render ScreenScrollView, ScreenMessage or a src/ui screen component (MilestonePlaceholder, PassphraseSetupForm)');
  }
  const start = source.indexOf('export default function');
  const nextFunction = source.indexOf('\nfunction ', start);
  const screenBody = source.slice(start, nextFunction === -1 ? undefined : nextFunction);
  const nullReturn = screenBody.indexOf('return null;');
  if (start >= 0 && nullReturn >= 0) {
    report(file, lineOf(source, start + nullReturn), 'R7', 'Screen returns null (blank screen); return <ScreenMessage loading /> instead');
  }
}

if (violations.length > 0) {
  for (const v of violations) console.error(`${v.file}:${v.line}  ${v.rule}  ${v.message}`);
  console.error(`\n${violations.length} UI convention violation(s). See mobile/docs/ui_conventions.md.`);
  process.exit(1);
}
console.log(`UI conventions OK: ${screenFiles.length} screens, ${appFiles.length + srcFiles.length} files checked (R1–R7).`);

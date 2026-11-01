// Node module hook used only by these tests: src/glassbox imports siblings
// without a file extension ("./tm"), as the app's bundler expects; node's
// type stripping needs the real file, so "./tm" is resolved to "./tm.ts".
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.endsWith('.ts')) {
    const url = new URL(specifier + '.ts', context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
}

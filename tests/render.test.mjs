import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve('vite'))('esbuild');
test('dashboard initial render has no missing runtime variables', () => {
  const result = buildSync({
    stdin: {contents: 'import React from "react"; import {renderToString} from "react-dom/server"; import App from "./src/App.jsx"; console.log(renderToString(React.createElement(App)));', resolveDir: fileURLToPath(new URL('..', import.meta.url))},
    bundle: true, platform: 'node', format: 'cjs', write: false, jsx: 'automatic',
    define: {'import.meta.env.BASE_URL': '"/"'}
  });
  const html = execFileSync(process.execPath, ['-e', result.outputFiles[0].text], {encoding:'utf8'});
  assert.match(html, /全球金融危机监测仪表盘/);
  assert.match(html, /每小时自动更新/);
});

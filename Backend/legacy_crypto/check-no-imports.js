#!/usr/bin/env node
'use strict';

/*
 * check-no-imports.js — CI guard: nothing outside Backend/legacy_crypto/ may
 * use the legacy from-scratch crypto lab.
 *
 * legacy_crypto/ is a teaching artifact (CSE447). Its code is NOT constant-
 * time and not maintained for production (see README.md here). This script
 * walks Backend/ — skipping node_modules/, legacy_crypto/ and .git/ — and
 * fails if any source file:
 *
 *   1. imports / requires something whose path mentions legacy_crypto,
 *      pyCrypto or crypto_cli (static require/import, dynamic import(),
 *      require.resolve, or a path built from string literals such as
 *      path.join(__dirname, '..', 'legacy_crypto', ...)), or
 *   2. loads child_process AND names a Python interpreter or a .py script
 *      in a string literal (spawn('python', ...), execFile('py', ...),
 *      exec('python3 tool.py'), const PY = 'python'; cp.spawn(PY, ...)).
 *
 * Python sources outside legacy_crypto/ are checked for
 * `import`/`from` of crypto_cli / legacy_crypto and for string literals that
 * mention them.
 *
 * Comments are stripped before matching, so documentation that mentions
 * these names (e.g. "replaced pyCrypto.js") does not trip the guard.
 *
 * Usage:
 *   node legacy_crypto/check-no-imports.js              # scan Backend/
 *   node legacy_crypto/check-no-imports.js --root DIR   # scan another tree
 *   node legacy_crypto/check-no-imports.js --self-test  # run built-in fixtures
 *
 * Exit status: 0 = clean, 1 = forbidden reference found (or self-test
 * failure), 2 = usage / I/O error. Uses only Node built-ins.
 */

const fs   = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['node_modules', 'legacy_crypto', '.git']);
const JS_EXT    = new Set(['.js', '.cjs', '.mjs', '.jsx', '.ts', '.cts', '.mts', '.tsx']);
const PY_EXT    = new Set(['.py']);

// Names that must not be referenced from application code.
const BANNED = /legacy_crypto|pyCrypto|crypto_cli/i;

// A string literal naming a Python interpreter (optionally with a path and
// .exe, optionally followed by arguments) or a .py script.
const PYTHON_LITERAL = /^\s*(?:\S*[\\/])?(?:python[0-9.]*|py)(?:\.exe)?(?:\s|$)|\.py(?:\s|$)/i;

// child_process loaded via require, import or dynamic import (with or
// without the node: prefix).
const CHILD_PROCESS = /\brequire\s*\(\s*(['"`])(?:node:)?child_process\1\s*\)|\bfrom\s*(['"`])(?:node:)?child_process\2|\bimport\s*\(\s*(['"`])(?:node:)?child_process\3\s*\)/;

// The code just before a string literal that makes it a module specifier.
const SPECIFIER_PREFIX = /(?:\brequire(?:\.resolve)?\s*\(|\bimport\s*\(|\bfrom|\bimport)\s*$/;


// ─────────────────────────────────────────────────────────────────────────────
// Lexing helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scan JS/TS source into { code, literals }:
 *   code     — the source with every comment replaced by spaces (newlines
 *              kept, so offsets and line numbers are unchanged);
 *   literals — every string / template literal as { value, start } where
 *              start is the offset of the opening quote.
 * A small state machine, not a full parser: regex literals containing
 * quote characters can confuse it, which errs toward reporting more.
 */
function lexJs(src) {
    let code = '';
    const literals = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        const d = src[i + 1];
        if (c === '/' && d === '/') {                        // line comment
            while (i < src.length && src[i] !== '\n') { code += ' '; i++; }
        } else if (c === '/' && d === '*') {                 // block comment
            code += '  ';
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
                code += src[i] === '\n' ? '\n' : ' ';
                i++;
            }
            code += '  ';
            i += 2;
        } else if (c === '"' || c === "'" || c === '`') {    // string literal
            const start = i;
            let value = '';
            code += c;
            i++;
            while (i < src.length && src[i] !== c) {
                if (src[i] === '\\' && i + 1 < src.length) {
                    value += src[i + 1];
                    code += src[i] + src[i + 1];
                    i += 2;
                    continue;
                }
                if (c !== '`' && src[i] === '\n') break;     // unterminated
                value += src[i];
                code += src[i];
                i++;
            }
            if (i < src.length) { code += src[i]; i++; }
            literals.push({ value, start });
        } else {
            code += c;
            i++;
        }
    }
    return { code, literals };
}

/**
 * Same idea for Python: blank out # comments, collect '...' / "..." literals
 * (triple-quoted strings are treated as literals too, so a docstring that
 * mentions a banned name is reported — rewording it is cheap).
 */
function lexPy(src) {
    let code = '';
    const literals = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === '#') {
            while (i < src.length && src[i] !== '\n') { code += ' '; i++; }
        } else if (c === '"' || c === "'") {
            const triple = src.startsWith(c.repeat(3), i);
            const close  = triple ? c.repeat(3) : c;
            const start  = i;
            let value = '';
            code += close;
            i += close.length;
            while (i < src.length && !src.startsWith(close, i)) {
                if (src[i] === '\\' && i + 1 < src.length) {
                    value += src[i + 1];
                    code += src[i] + src[i + 1];
                    i += 2;
                    continue;
                }
                if (!triple && src[i] === '\n') break;
                value += src[i];
                code += src[i];
                i++;
            }
            if (src.startsWith(close, i)) { code += close; i += close.length; }
            literals.push({ value, start });
        } else {
            code += c;
            i++;
        }
    }
    return { code, literals };
}

function lineOf(src, offset) {
    let line = 1;
    for (let i = 0; i < offset && i < src.length; i++) if (src[i] === '\n') line++;
    return line;
}

function show(value) {
    const v = value.length > 80 ? `${value.slice(0, 77)}...` : value;
    return JSON.stringify(v);
}


// ─────────────────────────────────────────────────────────────────────────────
// Detectors — each returns [{ line, message }]
// ─────────────────────────────────────────────────────────────────────────────

function checkJs(src) {
    const { code, literals } = lexJs(src);
    const findings = [];

    for (const lit of literals) {
        if (!BANNED.test(lit.value)) continue;
        const isSpecifier = SPECIFIER_PREFIX.test(code.slice(Math.max(0, lit.start - 40), lit.start));
        findings.push({
            line: lineOf(src, lit.start),
            message: isSpecifier
                ? `imports ${show(lit.value)}`
                : `string literal ${show(lit.value)} names a legacy crypto module (path building?)`
        });
    }

    if (CHILD_PROCESS.test(code)) {
        for (const lit of literals) {
            if (PYTHON_LITERAL.test(lit.value)) {
                findings.push({
                    line: lineOf(src, lit.start),
                    message: `child_process is loaded and ${show(lit.value)} names a Python interpreter/script`
                });
            }
        }
    }
    return findings;
}

function checkPy(src) {
    const { code, literals } = lexPy(src);
    const findings = [];
    const importRe = /^[ \t]*(?:from[ \t]+([\w.]+)[ \t]+import\b|import[ \t]+([\w., \t]+))/gm;
    let m;
    while ((m = importRe.exec(code)) !== null) {
        const mods = (m[1] || m[2] || '').split(',').map((s) => s.trim().split(/\s+/)[0]);
        for (const mod of mods) {
            if (BANNED.test(mod)) {
                findings.push({ line: lineOf(src, m.index), message: `imports Python module ${show(mod)}` });
            }
        }
    }
    for (const lit of literals) {
        if (BANNED.test(lit.value)) {
            findings.push({ line: lineOf(src, lit.start), message: `string literal ${show(lit.value)} names a legacy crypto module` });
        }
    }
    return findings;
}


// ─────────────────────────────────────────────────────────────────────────────
// Tree walk
// ─────────────────────────────────────────────────────────────────────────────

function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
        } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (JS_EXT.has(ext) || PY_EXT.has(ext)) out.push(path.join(dir, entry.name));
        }
    }
    return out;
}

function scan(root) {
    const files = walk(root, []);
    const findings = [];
    for (const file of files) {
        const src = fs.readFileSync(file, 'utf8');
        const ext = path.extname(file).toLowerCase();
        const found = PY_EXT.has(ext) ? checkPy(src) : checkJs(src);
        for (const f of found) findings.push({ file: path.relative(root, file), ...f });
    }
    return { files: files.length, findings };
}


// ─────────────────────────────────────────────────────────────────────────────
// Self-test fixtures
// ─────────────────────────────────────────────────────────────────────────────

function selfTest() {
    const mustFlag = [
        ['js', "const { callPython } = require('../legacy_crypto/pyCrypto');"],
        ['js', 'import { sha256 } from "../legacy_crypto/scratch/sha256.js";'],
        ['js', "async function f() { return import('./utils/pyCrypto.js'); }"],
        ['js', "const p = require.resolve('../legacy_crypto/scratch/rsa');"],
        ['js', "const rsa = require(path.join(__dirname, '..', 'legacy_crypto', 'scratch', 'rsa'));"],
        ['js', "const { spawn } = require('child_process');\nspawn('python', [script]);"],
        ['js', 'import { execFile } from "node:child_process";\nexecFile("python3", ["x"]);'],
        ['js', "const cp = require(\"child_process\");\nconst PY = 'py';\ncp.spawn(PY, ['-3', 'tool.py']);"],
        ['js', "const cp = require('child_process');\ncp.execSync(`C:\\\\Python312\\\\python.exe -c 1`);"],
        ['js', "const { fork } = await import('node:child_process');\nfork('worker.js', { execPath: '/usr/bin/python3' });"],
        ['py', 'from crypto_cli import dispatch'],
        ['py', 'import os, legacy_crypto.scratch_python.rsa as r'],
        ['py', "sys.path.insert(0, 'Backend/legacy_crypto/scratch_python')"]
    ];
    const mustPass = [
        ['js', '// replaced pyCrypto.js -> crypto_cli.py (legacy_crypto); see README\nconst x = 1;'],
        ['js', '/* legacy_crypto is a teaching artifact */ const y = require("./nativeCrypto");'],
        ['js', "const { spawn } = require('child_process');\nspawn('git', ['status']);"],
        ['js', "const languages = ['python', 'py', 'node'];   // no child_process here"],
        ['js', "const url = 'http://example.com/a//b'; const z = require('crypto');"],
        ['js', "const msg = \"don't // break\"; /* python */ const q = 'ok';"],
        ['py', '# from crypto_cli import dispatch\nimport hashlib'],
        ['py', 'import json  # legacy_crypto is not used here']
    ];

    let failures = 0;
    const run = (kind, src) => (kind === 'py' ? checkPy(src) : checkJs(src));
    mustFlag.forEach(([kind, src], i) => {
        const f = run(kind, src);
        if (f.length === 0) { failures++; console.log(`FAIL  must-flag #${i + 1} (${kind}) not flagged: ${JSON.stringify(src)}`); }
    });
    mustPass.forEach(([kind, src], i) => {
        const f = run(kind, src);
        if (f.length !== 0) { failures++; console.log(`FAIL  must-pass #${i + 1} (${kind}) flagged: ${f.map((x) => x.message).join('; ')}`); }
    });
    const total = mustFlag.length + mustPass.length;
    console.log(`${failures === 0 ? 'PASS' : 'FAIL'}  check-no-imports self-test: ${total - failures}/${total} fixtures ` +
        `(${mustFlag.length} must-flag, ${mustPass.length} must-pass)`);
    return failures === 0;
}


// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function main(argv) {
    if (argv.includes('--self-test')) return selfTest() ? 0 : 1;

    let root = path.resolve(__dirname, '..');                  // Backend/
    const rootIdx = argv.indexOf('--root');
    if (rootIdx !== -1) {
        if (!argv[rootIdx + 1]) { console.error('usage: check-no-imports.js [--root DIR] [--self-test]'); return 2; }
        root = path.resolve(argv[rootIdx + 1]);
    }
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        console.error(`check-no-imports: not a directory: ${root}`);
        return 2;
    }

    const { files, findings } = scan(root);
    for (const f of findings) console.log(`FAIL  ${f.file}:${f.line}  ${f.message}`);
    const skipped = [...SKIP_DIRS].join(', ');
    if (findings.length === 0) {
        console.log(`check-no-imports: OK — scanned ${files} source file(s) under ${root} (skipping ${skipped})`);
        return 0;
    }
    console.log(`check-no-imports: ${findings.length} forbidden reference(s) in ${files} scanned file(s). ` +
        'legacy_crypto/ is a non-constant-time teaching artifact and must not be used by the app; ' +
        'use Backend/utils/nativeCrypto.js instead.');
    return 1;
}

if (require.main === module) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (err) {
        console.error(`check-no-imports: error: ${err && err.message}`);
        process.exitCode = 2;
    }
}

module.exports = { checkJs, checkPy, scan };

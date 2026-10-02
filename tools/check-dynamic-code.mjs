import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
    dirname,
    join,
    resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Every way the JS glue could evaluate a string as code. A Content Security
// Policy without 'unsafe-eval' refuses all of them, and the build is linked
// with -sEMBIND_AOT and -sDYNAMIC_EXECUTION=0 so that none is emitted.
const DYNAMIC_CODE_PATTERNS = Object.freeze([
    ["eval()", /\beval\s*\(/g],
    ["indirect eval()", /\beval\s*\)\s*\(|\[\s*["'`]eval["'`]\s*\]/g],
    ["new Function()", /\bnew\s+Function\b/g],
    ["Function()", /(?<![\w$.])(?<!\bnew\s+)Function\s*\(/g],
    ["string timer", /\bset(?:Timeout|Interval)\s*\(\s*["'`]/g],
]);

function parseOptions(arguments_) {
    if (arguments_.length === 0) {
        return join(REPOSITORY_ROOT, "lib");
    }
    assert.equal(
        arguments_[0],
        "--directory",
        "Usage: node tools/check-dynamic-code.mjs [--directory <path>]",
    );
    assert.ok(arguments_[1], "A directory is required");
    assert.equal(arguments_.length, 2, "Unexpected options");
    return resolve(process.cwd(), arguments_[1]);
}

function locate(source, index) {
    const before = source.slice(0, index);
    const line = before.split("\n").length;
    const column = index - before.lastIndexOf("\n");
    return `${line}:${column}`;
}

export async function findDynamicCode(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const scripts = entries
        .filter((entry) => entry.isFile() && /\.(?:c|m)?js$/.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    assert.ok(scripts.length > 0, `No JavaScript files found in ${directory}`);

    const findings = [];
    for (const name of scripts) {
        const source = await readFile(join(directory, name), "utf8");
        for (const [label, pattern] of DYNAMIC_CODE_PATTERNS) {
            for (const match of source.matchAll(pattern)) {
                findings.push({
                    excerpt: source.slice(
                        Math.max(0, match.index - 40),
                        match.index + 60,
                    ).replace(/\s+/g, " "),
                    file: name,
                    label,
                    location: locate(source, match.index),
                });
            }
        }
    }
    return { findings, scripts };
}

async function main() {
    const directory = parseOptions(process.argv.slice(2));
    const { findings, scripts } = await findDynamicCode(directory);
    for (const finding of findings) {
        process.stderr.write(
            `${finding.file}:${finding.location} ${finding.label}: `
            + `${finding.excerpt}\n`,
        );
    }
    if (findings.length > 0) {
        process.stderr.write(
            `${findings.length} dynamic code site(s) in ${scripts.length} file(s)\n`,
        );
        process.exitCode = 1;
        return;
    }
    process.stdout.write(
        `No dynamic code in ${scripts.length} file(s): ${scripts.join(", ")}\n`,
    );
}

if (
    process.argv[1]
    && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    await main();
}

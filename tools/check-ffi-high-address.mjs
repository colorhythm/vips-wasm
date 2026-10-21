import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [packageDirectory, output] = process.argv.slice(2);
assert.ok(packageDirectory && output, "Usage: node ffi-high-address-probe.mjs /absolute/package /absolute/new-report.json");
const require = createRequire(import.meta.url);
const metadata = JSON.parse(await readFile(path.join(packageDirectory, "package.json"), "utf8"));
const entry = path.join(packageDirectory, "lib/vips-node.js");
const wasmPath = path.join(packageDirectory, "lib/vips.wasm");
const wasmBytes = await readFile(wasmPath);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const report = {
    actualPackage: `${metadata.name}@${metadata.version}`,
    artifacts: {
        entry: { path: entry, sha256: hash(await readFile(entry)) },
        wasm: { path: wasmPath, sha256: hash(wasmBytes) }
    },
    cases: [],
    description: "Calls the actual unmodified package's captured ffi_call_js import closure with synthetic native ffi_cif descriptors and sparse malloc-backed high addresses.",
    nodeVersion: process.version,
    passed: false,
    processMemoryBefore: process.memoryUsage(),
    source: {
        libffiCommit: "12ffd1f9dc56fcea79d2f742f424301ae668d663",
        libffiVersion: "3.8.0",
        sourceUrl: "https://github.com/libffi/libffi/blob/v3.8.0/src/wasm/ffi.c"
    }
};
let vips;
let memory;
let ffi;
let functionIndex;
let table;
let lowBase;
const allocations = [];
const started = performance.now();
try {
    const factory = require(entry);
    const module = await WebAssembly.compile(wasmBytes);
    vips = await factory({
        dynamicLibraries: ["vips-heif.wasm", "vips-jxl.wasm", "vips-resvg.wasm"],
        instantiateWasm(imports, success) {
            memory = imports.env.memory;
            ffi = imports.env.ffi_call_js;
            const instance = new WebAssembly.Instance(module, imports);
            table = instance.exports.__indirect_function_table;
            success(instance, module);
            return instance.exports;
        }
    });
    assert.ok(memory instanceof WebAssembly.Memory, "captured actual imported Wasm memory");
    assert.equal(typeof ffi, "function", "captured actual ffi_call_js import");
    report.ffiCallJsFunctionSha256 = hash(ffi.toString());
    report.initialMemoryBytes = memory.buffer.byteLength;
    lowBase = vips.___libc_malloc(1024) >>> 0;
    assert.ok(lowBase > 0 && lowBase + 1024 < 0x80000000, "native low test fixture allocation");
    allocations.push(lowBase);
    const blockBytes = 805306368;
    report.reservations = [];
    for (let index = 0; index < 3; index += 1) {
        const pointer = vips.___libc_malloc(blockBytes) >>> 0;
        report.reservations.push({ bytes: blockBytes, heapBytes: memory.buffer.byteLength, pointer });
        assert.notEqual(pointer, 0, `native sparse reservation ${index + 1} returned null`);
        allocations.push(pointer);
    }
    const highBase = 0x80010000;
    assert.ok(report.reservations.some(allocation => highBase >= allocation.pointer && highBase + 1024 <= allocation.pointer + allocation.bytes), "high fixture stays inside a held native allocation");
    report.highBase = highBase;
    report.highBaseHex = `0x${highBase.toString(16)}`;
    report.finalMemoryBytes = memory.buffer.byteLength;
    const seen = [];
    functionIndex = vips.addFunction(value => {
        seen.push(value);
        return value + 1;
    }, "ii");
    assert.equal(typeof table.get(functionIndex), "function", "callback registered in actual Wasm table");
    report.callbackFunctionIndex = functionIndex;
    const specifications = [
        { label: "low-control", input: 123 },
        { label: "low-negative-value-control", input: -123 },
        { label: "high-argument-value", high: ["argument"], input: 123 },
        { label: "high-argument-value-negative-number", high: ["argument"], input: -123 },
        { label: "high-argument-vector-number", high: ["avalue"], input: 123 },
        { label: "high-argument-vector-wasm-signed", high: ["avalue"], input: 123, wasmSigned: true },
        { label: "high-cif-number", high: ["cif"], input: 123 },
        { label: "high-cif-wasm-signed", high: ["cif"], input: 123, wasmSigned: true },
        { label: "high-argument-type", high: ["argumentType"], input: 123 },
        { label: "high-argument-types-vector", high: ["argumentTypes"], input: 123 },
        { label: "high-return-type", high: ["returnType"], input: 123 },
        { label: "high-return-value-number", high: ["rvalue"], input: 123 },
        { label: "high-return-value-wasm-signed", high: ["rvalue"], input: 123, wasmSigned: true },
        { label: "high-all-number", high: ["argument", "argumentType", "argumentTypes", "avalue", "cif", "returnType", "rvalue"], input: 123 },
        { label: "high-all-wasm-signed", high: ["argument", "argumentType", "argumentTypes", "avalue", "cif", "returnType", "rvalue"], input: 123, wasmSigned: true }
    ];
    for (const specification of specifications) {
        const high = new Set(specification.high ?? []);
        const fields = ["argument", "argumentType", "argumentTypes", "avalue", "cif", "returnType", "rvalue"];
        const pointers = Object.fromEntries(fields.map((field, index) => [field, (high.has(field) ? highBase : lowBase) + index * 64]));
        new Uint8Array(memory.buffer, lowBase, 1024).fill(0);
        new Uint8Array(memory.buffer, highBase, 1024).fill(0);
        const view = new DataView(memory.buffer);
        const uint = (pointer, value) => view.setUint32(pointer, value, true);
        for (const type of [pointers.argumentType, pointers.returnType]) {
            uint(type, 4);
            view.setUint16(type + 4, 4, true);
            view.setUint16(type + 6, 10, true);
            uint(type + 8, 0);
        }
        uint(pointers.argument, specification.input);
        uint(pointers.argumentTypes, pointers.argumentType);
        uint(pointers.avalue, pointers.argument);
        uint(pointers.rvalue, 0x12345678);
        const cif = [1, 1, pointers.argumentTypes, pointers.returnType, 0, 0, 1];
        cif.forEach((value, index) => uint(pointers.cif + index * 4, value));
        const convert = pointer => specification.wasmSigned ? pointer | 0 : pointer;
        const seenBefore = seen.length;
        const result = {
            expectedInput: specification.input,
            expectedReturn: specification.input + 1,
            highFields: Array.from(high),
            label: specification.label,
            passed: false,
            pointers,
            wasmSignedIncomingPointers: Boolean(specification.wasmSigned)
        };
        try {
            ffi(convert(pointers.cif), functionIndex, convert(pointers.rvalue), convert(pointers.avalue));
        } catch (error) {
            result.error = { message: error.message, stack: error.stack };
        }
        result.observedCallbackInputs = seen.slice(seenBefore);
        result.observedReturn = view.getInt32(pointers.rvalue, true);
        result.passed = !result.error && result.observedCallbackInputs.length === 1 && result.observedCallbackInputs[0] === result.expectedInput && result.observedReturn === result.expectedReturn;
        report.cases.push(result);
    }
    report.lowControlsPassed = report.cases.filter(result => result.highFields.length === 0).every(result => result.passed);
    report.highCasesPassed = report.cases.filter(result => result.highFields.length > 0).every(result => result.passed);
    report.passed = report.lowControlsPassed && report.highCasesPassed;
    report.processMemoryAfterCases = process.memoryUsage();
} catch (error) {
    report.error = { message: error.message, stack: error.stack };
} finally {
    report.freedPointers = [];
    for (const pointer of allocations.reverse()) {
        vips.___libc_free(pointer);
        report.freedPointers.push(pointer);
    }
    report.elapsedMs = performance.now() - started;
    report.processMemoryFinal = process.memoryUsage();
    report.processResourceUsage = process.resourceUsage();
    report.peakResidentBytes = process.versions.node.startsWith("17.") && process.platform === "darwin" ? report.processResourceUsage.maxRSS : report.processResourceUsage.maxRSS * 1024;
    try {
        vips?.shutdown();
    } catch (error) {
        report.shutdownError = error.message;
    }
    await writeFile(output, `${JSON.stringify(report, null, 4)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ cases: report.cases.map(({ label, passed, observedReturn, observedCallbackInputs, error }) => ({ label, passed, observedReturn, observedCallbackInputs, error: error?.message })), lowControlsPassed: report.lowControlsPassed, highCasesPassed: report.highCasesPassed, output, passed: report.passed }, null, 4));
    process.exit(report.passed ? 0 : 1);
}

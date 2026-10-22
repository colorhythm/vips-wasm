import hashlib
import json
from pathlib import Path
import subprocess
import sys


source = Path(sys.argv[1]).resolve()
baseline_commit = "493ac2735e80bc74c409f1fb4d7f88360952a122"
baseline = json.loads(subprocess.check_output([
    "git", "show", f"{baseline_commit}:integrity.json"
], cwd=source, text=True))
metadata = json.loads((source / "package.json").read_text())
assert metadata["version"] == "0.0.19-colorhythm.2026102104"
manifest = baseline.copy()
manifest["package"] = {
    "name": metadata["name"],
    "version": metadata["version"],
}
manifest["source"] = dict(baseline["source"])
manifest["source"]["colorhythmCandidate"] = {
    "allocator": "dlmalloc",
    "baseCommit": baseline_commit,
    "buildCommit": subprocess.check_output([
        "git", "rev-parse", "HEAD"
    ], cwd=source, text=True).strip(),
    "browserDiscThresholdBytes": 2147483648,
    "dynamicExecution": False,
    "embindAot": False,
    "embindRefreshVectorHeapViews": True,
    "embindUnsignedVectorHeapIndices": True,
    "initialMemoryBytes": 268435456,
    "libffiUnsignedWasm32HeapIndices": True,
    "maximumMemoryBytes": 4294967296,
    "memoryGrowth": True,
    "previousExperimentVersion": "0.0.19-colorhythm.2026102103",
    "purpose": "Isolated dlmalloc allocator feasibility experiment; not release evidence; no activation or publication",
}
manifest["files"] = {}
for name in sorted(baseline["files"]):
    payload = (source / name).read_bytes()
    manifest["files"][name] = {
        "sha256": hashlib.sha256(payload).hexdigest(),
        "size": len(payload),
    }
(source / "integrity.json").write_text(json.dumps(manifest, indent=4) + "\n")
print(json.dumps(manifest, indent=4))

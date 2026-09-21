"""Archive the current sources (including local edits), never credentials or user data."""
import argparse
import hashlib
import json
import os
import subprocess
import zipfile
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--repo', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--private-config', type=Path, required=True)
args = p.parse_args()
repo = args.repo.resolve()
keys = [c['key'].encode() for c in json.loads(args.private_config.read_text())['credentials'] if len(c['key']) > 8]
exclude_dirs = {'.git', 'node_modules', 'build', 'dist', '.tools', '__pycache__', '.cache', '.pytest_cache',
                'staging', 'build-temp', 'xulrunner', 'artifacts', 'screenshots', 'coverage', '.venv', 'venv'}
exclude_names = {'workspace.json', 'logins.json', 'key4.db', 'cert9.db', 'easysch-provider-defaults.json',
                 'easysch-provider-setup.json', 'provider-setup.json', '.signatures.json'}
files = []
for directory, dirs, names in os.walk(repo):
    dirs[:] = sorted(n for n in dirs if n not in exclude_dirs and not (Path(directory)/n).is_symlink())
    for name in sorted(names):
        f = Path(directory)/name
        rel = f.relative_to(repo)
        if f.is_symlink() or name in exclude_names or name == '.git' or name.startswith('.env') or name.endswith(('.pyc','.log','.sqlite','.sqlite-wal','.sqlite-shm')):
            continue
        # Native build caches and release binaries have separate redistribution notices.
        if len(rel.parts) > 1 and rel.parts[:2] in [('app','dist'),('app','builds'),('app','tmp')]:
            continue
        data = f.read_bytes()
        if any(key in data for key in keys):
            raise RuntimeError('A private API credential was detected in source file: '+str(rel))
        files.append((f, rel))
args.output.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(args.output,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for f, rel in files:
        z.write(f, 'EasySch-source/'+rel.as_posix())
    info = {'baseCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),
            'workingTreeIncluded':True,'files':len(files),'privateCredentialsIncluded':False}
    z.writestr('EasySch-source/SOURCE-MANIFEST.json',json.dumps(info,indent=2))
print(json.dumps({'archive':str(args.output),'files':len(files),'bytes':args.output.stat().st_size}))

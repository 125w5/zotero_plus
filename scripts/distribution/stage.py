"""Assemble a relocatable Windows payload. Never copies user libraries or profiles."""
import argparse
import json
import shutil
import zipfile
from pathlib import Path


def copy_tree(source, target, exclude=()):
    shutil.copytree(source, target, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.git', *exclude))


def strip_tests(archive):
    temporary = archive.with_suffix('.release.tmp')
    with zipfile.ZipFile(archive) as source, zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as target:
        for item in source.infolist():
            if item.filename.startswith('test/'):
                continue
            data = source.read(item)
            if item.filename == 'chrome.manifest':
                data = ('\n'.join(line for line in data.decode().splitlines() if 'zotero-unit' not in line) + '\n').encode()
            target.writestr(item.filename, data)
    temporary.replace(archive)


def main(args):
    repo, tools, output = args.repo.resolve(), args.tools.resolve(), args.output.resolve()
    if not output.is_relative_to(repo / 'dist') and not output.is_relative_to(tools / 'package-validation'):
        raise ValueError('Payload must stay in dist or the isolated package-validation directory.')
    output.mkdir(parents=True, exist_ok=True)
    if (output / 'client').exists():
        raise ValueError('Choose a fresh payload directory; existing packages are not overwritten.')
    copy_tree(repo / 'app/staging/Zotero_win-x64', output / 'client', () if args.include_tests else ('tests',))
    if not args.include_tests:
        strip_tests(output / 'client/app/omni.ja')
    runtime = output / 'runtime'
    (runtime / 'node').mkdir(parents=True)
    shutil.copy2(args.node, runtime / 'node/node.exe')
    shutil.copy2(tools / 'package-private/NODE-LICENSE.txt', runtime / 'node/LICENSE.txt')
    copy_tree(repo / 'services/research-engine', runtime / 'research-engine', ('test', 'tests', '.cache'))
    copy_tree(repo / 'chrome/content/zotero/research/shared', output / 'chrome/content/zotero/research/shared')
    # An actual standalone CPython directory, never the development venv launchers.
    python = runtime / 'python'
    python.mkdir()
    for name in ['python.exe', 'pythonw.exe', 'python3.dll', 'python312.dll',
                 'vcruntime140.dll', 'vcruntime140_1.dll', 'LICENSE.txt']:
        shutil.copy2(args.python_home / name, python / name)
    copy_tree(args.python_home / 'DLLs', python / 'DLLs')
    copy_tree(args.python_home / 'Lib', python / 'Lib', ('site-packages', 'test', 'tests', 'idlelib', 'ensurepip'))
    copy_tree(tools / 'pdf-assets-env/Lib/site-packages', python / 'Lib/site-packages',
              ('pip', 'pip-*.dist-info', 'setuptools', 'setuptools-*.dist-info', 'test', 'tests'))
    copy_tree(tools / 'pandoc/pandoc-3.11', runtime / 'pandoc')
    copy_tree(tools / 'libreoffice', runtime / 'libreoffice', ('LibreOffice.msi',))
    copy_tree(tools / 'poppler', runtime / 'poppler')
    config = {'version': 1, 'release': args.release, 'runtime': {
        'node': 'runtime/node/node.exe', 'engine': 'runtime/research-engine/src/cli.mjs',
        'python': 'runtime/python/python.exe', 'pandoc': 'runtime/pandoc/pandoc.exe',
        'soffice': 'runtime/libreoffice/program/soffice.exe', 'poppler': 'runtime/poppler/Library/bin'}}
    (output / 'client/easysch-distribution.json').write_text(json.dumps(config, indent=2), 'utf-8')
    if args.credentials:
        data = json.loads(args.credentials.read_text('utf-8'))
        if data.get('version') != 1 or not data.get('credentials'):
            raise ValueError('The private API configuration is empty.')
        shutil.copy2(args.credentials, output / 'client/easysch-provider-defaults.json')
        print('Included API providers:', len(data['credentials']))
    # Existing profiles and any independently installed Zotero are unaffected.
    policies = output / 'client/distribution'
    policies.mkdir(exist_ok=True)
    (policies / 'policies.json').write_text(json.dumps({'policies': {'DisableAppUpdate': True}}), 'utf-8')
    ini = output / 'client/app/application.ini'
    ini.write_text(ini.read_text('utf-8').replace('Name=Zotero', 'Name=EasySch'), 'utf-8')
    shutil.copy2(repo / 'COPYING', output / 'LICENSE.txt')
    shutil.copy2(repo / 'scripts/distribution/README.zh-CN.md', output / '使用说明.md')
    shutil.copy2(repo / 'scripts/distribution/THIRD-PARTY.md', output / '第三方许可与源码.md')
    # The supplied symbol is transparent; a neutral tile keeps the OS shortcut visible.
    from PIL import Image
    symbol = Image.open(repo / 'chrome/content/zotero/research/brand/easysch-symbol-black.png').convert('RGBA')
    symbol.thumbnail((204, 204), Image.Resampling.LANCZOS)
    icon = Image.new('RGBA', (256, 256), '#f4f5f7')
    icon.alpha_composite(symbol, ((256-symbol.width)//2, (256-symbol.height)//2))
    icon.save(output / 'EasySch.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
    print('Payload:', output)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    for name in ['repo', 'tools', 'output', 'node', 'python-home']:
        p.add_argument('--'+name, type=Path, required=True)
    p.add_argument('--credentials', type=Path)
    p.add_argument('--release', required=True)
    p.add_argument('--include-tests', action='store_true')
    main(p.parse_args())

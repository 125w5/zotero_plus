"""Exercise the shipped Windows tools with a clean PATH and no network/API calls."""
import argparse
import json
import os
import subprocess
import tempfile
import zipfile
from pathlib import Path


def verify(payload, include_tests=False):
    payload = payload.resolve()
    manifest = json.loads((payload / 'client/easysch-distribution.json').read_text('utf-8'))
    report = {'release': manifest['release'], 'configuration': manifest.get('configuration', 'unknown'),
              'networkRequests': 0, 'checks': [], 'limitations': [
                  'Runtime checks run locally with isolated environment variables; this is not a clean Windows virtual machine.',
                  'The native application and remote AI services are not started by this check.']}
    tools = {}
    for name, relative in manifest['runtime'].items():
        target = (payload / relative).resolve()
        if not target.is_relative_to(payload) or not target.exists():
            raise RuntimeError('Missing or external packaged runtime: ' + name)
        tools[name] = target
    system = Path(os.environ.get('SystemRoot', r'C:\Windows'))
    environment = dict(os.environ, PATH=str(system / 'System32') + os.pathsep + str(system), PYTHONNOUSERSITE='1')
    for name in ['PYTHONHOME', 'PYTHONPATH', 'NODE_PATH', 'NODE_OPTIONS']:
        environment.pop(name, None)

    def run(command, data=None, timeout=180):
        result = subprocess.run([str(value) for value in command], input=data, text=True, encoding='utf-8',
                                capture_output=True, env=environment, timeout=timeout,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            raise RuntimeError(Path(command[0]).name + ' failed: ' + (result.stderr or result.stdout)[-900:])
        return result.stdout

    def engine(request):
        events = [json.loads(line) for line in run([tools['node'], tools['engine']], json.dumps(request)).splitlines() if line.strip()]
        errors = [event['message'] for event in events if event.get('type') == 'error']
        if errors:
            raise RuntimeError('; '.join(errors))
        results = [event['value'] for event in events if event.get('type') == 'result']
        if len(results) != 1:
            raise RuntimeError('The packaged document engine did not return one result.')
        return results[0]

    forbidden = {'prefs.js', 'user.js', 'logins.json', 'key4.db', 'cert9.db', 'zotero.sqlite', 'workspace.json',
                 '.env', 'provider-setup.json', 'easysch-provider-setup.json'}
    unexpected = [str(path.relative_to(payload)) for path in payload.rglob('*')
                  if path.is_file() and (path.name in forbidden or path.name.startswith('.env.') or '.sqlite' in path.name)]
    if unexpected:
        raise RuntimeError('User data or developer configuration entered the payload: ' + ', '.join(unexpected[:8]))
    bundled_providers = payload / 'client/easysch-provider-defaults.json'
    if manifest.get('configuration') == 'standard' and bundled_providers.exists():
        raise RuntimeError('A standard payload must not include API defaults.')
    if manifest.get('configuration') == 'preconfigured' and not bundled_providers.is_file():
        raise RuntimeError('The authorized preconfigured payload is missing its API defaults.')
    with zipfile.ZipFile(payload / 'client/app/omni.ja') as archive:
        test_entries = [name for name in archive.namelist() if name.startswith('test/')]
        if not include_tests and (test_entries or 'zotero-unit' in archive.read('chrome.manifest').decode()):
            raise RuntimeError('A production payload still exposes native test entry points.')
    report['checks'].append('Runtime paths stay inside the package; no user library/profile copied; production test entries removed.')
    node_version = run([tools['node'], '--version']).strip()
    if int(node_version.lstrip('v').split('.')[0]) < 22:
        raise RuntimeError('The bundled Node version is below the supported engine version.')
    report['node'] = node_version
    imports = run([tools['python'], '-I', '-c',
                   'import json,sys,pymupdf,openpyxl,xlrd,docx,lxml.etree; print(json.dumps({"python":sys.version.split()[0],"pymupdf":pymupdf.VersionBind}))'])
    report.update(json.loads(imports))
    for name, command in [('pandoc', [tools['pandoc'], '--version']),
                          ('poppler', [tools['poppler'] / 'pdftoppm.exe', '-v'])]:
        run(command)
        report['checks'].append(name + ' starts from the bundled directory with only Windows on PATH.')
    prompt = engine({'operation': 'prompt'})
    if not prompt.get('sections') or not prompt.get('tools'):
        raise RuntimeError('The packaged Node engine cannot load its dependencies/shared modules.')
    report['checks'].append('The Node engine loads its npm dependencies and shared research modules.')

    with tempfile.TemporaryDirectory(prefix='EasySch-runtime-check-') as temporary:
        folder = Path(temporary) / '中文资料'
        folder.mkdir()
        csv, xlsx, pdf = folder / '实验数据.csv', folder / '实验数据.xlsx', folder / '原文.pdf'
        csv.write_text('方法,说明\nCNN,卷积神经网络\n', 'utf-8')
        fixture = ('import pymupdf,openpyxl,sys; d=pymupdf.open(); p=d.new_page(); '
                   'p.insert_text((55,70),"Packaged PDF reading fixture with complete source text and a real page."); '
                   'd.save(sys.argv[1]); w=openpyxl.Workbook(); s=w.active; '
                   's.append(["方法","说明"]); s.append(["CNN","卷积神经网络"]); w.save(sys.argv[2])')
        run([tools['python'], '-I', '-c', fixture, pdf, xlsx])
        common = {'python': str(tools['python']), 'cacheRoot': str(folder / 'cache')}
        for table in [csv, xlsx]:
            dataset = engine(dict(common, operation='manuscript-data', file=str(table)))
            if '卷积神经网络' not in json.dumps(dataset, ensure_ascii=False):
                raise RuntimeError('Chinese table cells were not read correctly: ' + table.suffix)
        text = engine(dict(common, operation='assets-text', pdf=str(pdf)))
        if 'complete source text' not in json.dumps(text):
            raise RuntimeError('The packaged Python/PDF engine did not extract the real PDF text.')
        cover = engine(dict(common, operation='assets-cover', pdf=str(pdf)))
        if not cover or not any(Path(value).is_file() for key, value in cover.items() if key in ('path', 'thumbnail') and isinstance(value, str)):
            raise RuntimeError('The packaged PDF engine did not render a real page cover.')
        report['checks'].append('Bundled Python reads Chinese CSV/XLSX, extracts a real PDF and renders its page cover.')
        document = engine({'operation': 'manuscript-export', 'python': str(tools['python']),
                           'pandoc': str(tools['pandoc']), 'directory': str(folder), 'project': {
                               'title': '安装包文档处理验证', 'sections': [{'id': 's', 'title': '方法'}], 'blocks': [
                                   {'id': 'p', 'sectionID': 's', 'type': 'paragraph', 'text': '这是运行时验证文字，不是实验结果。'},
                                   {'id': 'f', 'sectionID': 's', 'type': 'formula', 'text': 'E=mc^2'}]}})
        with zipfile.ZipFile(document['path']) as archive:
            if '<m:oMath' not in archive.read('word/document.xml').decode():
                raise RuntimeError('The exported Word file lacks an editable OMML equation.')
        report['checks'].append('Python and Pandoc export a real DOCX with an editable Word equation.')
        deck = engine({'operation': 'export', 'directory': str(folder),
                       'record': {'sources': [{'id': 'fixture', 'text': '软件运行时验证文字，非实验数据'}]},
                       'plan': {'version': 1, 'title': '运行时验证', 'slides': [
                           {'kind': 'text', 'title': '中文汇报导出', 'bullets': ['可编辑正文和页面预览'],
                            'sources': ['fixture'], 'notes': '软件打包验证，不使用模型。'}]},
                       'render': {'soffice': str(tools['soffice']), 'pdftoppm': str(tools['poppler'] / 'pdftoppm.exe'),
                                  'pdftotext': str(tools['poppler'] / 'pdftotext.exe')}})
        if not Path(deck['path']).is_file() or not deck.get('previews') or not all(Path(file).is_file() for file in deck['previews']):
            raise RuntimeError('PPTX export or real LibreOffice/Poppler preview rendering failed.')
        report['checks'].append('The engine exports a real PPTX and renders its page with bundled LibreOffice/Poppler.')
    report['status'] = 'passed'
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--payload', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--include-tests', action='store_true')
    args = parser.parse_args()
    try:
        result = verify(args.payload, args.include_tests)
    except Exception as error:
        result = {'status': 'failed', 'networkRequests': 0, 'error': str(error)}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, indent=2, ensure_ascii=False), 'utf-8')
    print(json.dumps({'status': result['status'], 'checks': len(result.get('checks', [])), 'report': str(args.report)}))
    raise SystemExit(0 if result['status'] == 'passed' else 1)

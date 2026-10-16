"""Export the assessed execution plan through the editable manuscript pipeline."""
from pathlib import Path
from document import export


def export_plan(request):
    target = Path(request['directory']) / 'execution-plan.docx'
    if target.exists():
        raise ValueError('执行方案文件已经存在，未覆盖原文件')
    result = export(dict(request, operation='manuscript-plan-export'))
    source = Path(result['path'])
    source.replace(target)
    return dict(result, path=str(target), directory=str(target.parent), kind='execution-plan')

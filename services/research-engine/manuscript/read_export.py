"""Export the assembly read and task plan through the editable manuscript pipeline."""
import tempfile
from pathlib import Path
from document import export


def export_read(request):
    root = Path(request['directory'])
    root.mkdir(parents=True, exist_ok=True)
    folder = Path(tempfile.mkdtemp(prefix='assembly-read-', dir=root))
    target = folder / 'assembly-read.docx'
    if target.exists():
        raise ValueError('速读与任务计划文件已经存在，未覆盖原文件')
    result = export(dict(request, operation='manuscript-read-export', directory=str(folder)))
    Path(result['path']).replace(target)
    return dict(result, path=str(target), directory=str(folder), kind='assembly-read')

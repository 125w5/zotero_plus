"""Import supplied observations. Never evaluate Excel formulas or synthesize values."""
import csv, math, zipfile
from pathlib import Path

def read_dataset(filename):
    path=Path(filename)
    if path.stat().st_size>1_000_000: raise ValueError('数据文件超过 1 MB')
    if path.suffix.lower()=='.csv':
        with path.open(encoding='utf-8-sig',newline='') as f: rows=list(csv.reader(f))
    elif path.suffix.lower()=='.xlsx':
        from openpyxl import load_workbook
        with zipfile.ZipFile(path) as z:
            if sum(i.file_size for i in z.infolist())>10_000_000: raise ValueError('Excel 解压后超过限制')
        workbook=load_workbook(path,read_only=True,data_only=False,keep_links=False)
        try: rows=[list(r) for r in workbook.active.iter_rows(values_only=True)]
        finally: workbook.close()
    else: raise ValueError('请选择 CSV、XLSX 或 JSON 数据')
    rows=[r for r in rows if any(v is not None and str(v).strip() for v in r)]
    if not 2<=len(rows)<=31 or not 2<=len(rows[0])<=6: raise ValueError('需要表头、1–30 行观测和 1–5 个数值列')
    if any(len(r)!=len(rows[0]) for r in rows): raise ValueError('数据行列数不一致')
    series=[]
    for n,name in enumerate(rows[0][1:],1):
        values=[]
        for row in rows[1:]:
            if row[n] is None or str(row[n]).strip()=='' or str(row[n]).startswith('='): raise ValueError('存在缺失值或公式，请导出已核对的数值快照')
            number=float(row[n])
            if not math.isfinite(number): raise ValueError('观测值必须是有限数值')
            values.append(number)
        series.append(dict(name=str(name),values=values))
    return [dict(id=path.stem,provenance=path.name+'；用户导入的数值快照，单位和样本量请核对',labels=[str(r[0]) for r in rows[1:]],series=series)]

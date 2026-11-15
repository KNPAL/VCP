"""Fetch the six official bhavcopies required by the initial 2026-11-11 scan."""
import csv
import hashlib
import io
import json
from pathlib import Path
import time
import zipfile
import requests

root = Path('.runtime/official-nse')
root.mkdir(parents=True, exist_ok=True)
records = []
for day in ['20260201', '20261108', '20261111', '20260527', '20250922', '20260603']:
    url = f'https://archives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{day}_F_0000.csv.zip'
    response = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=60)
    response.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        files = [name for name in archive.namelist() if name.lower().endswith('.csv')]
        if len(files) != 1:
            raise ValueError('Expected one bhavcopy CSV')
        rows = list(csv.DictReader(io.StringIO(archive.read(files[0]).decode('utf-8-sig'))))
    session = f'{day[:4]}-{day[4:6]}-{day[6:]}'
    if not rows or any(row['TradDt'] != session for row in rows):
        raise ValueError('Unexpected bhavcopy session')
    (root / f'bhavcopy-{day}.zip').write_bytes(response.content)
    (root / f'bhavcopy-{day}.json').write_text(json.dumps(rows), encoding='utf-8')
    records.append({'session': session, 'url': url, 'sha256': hashlib.sha256(response.content).hexdigest()})
    print(session, len(rows), flush=True)
    time.sleep(1)
(root / 'bhavcopy-manifest.json').write_text(json.dumps(records, indent=2), encoding='utf-8')

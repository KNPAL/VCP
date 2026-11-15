"""Download official public scan inputs; no broker credentials or source-app writes."""
import datetime as dt
import hashlib
import json
from pathlib import Path
import time
import requests

ROOT = Path('.runtime/official-nse')
ROOT.mkdir(parents=True, exist_ok=True)
END = dt.date.fromisoformat(__import__('sys').argv[1]) if len(__import__('sys').argv) > 1 else dt.date(2026, 11, 11)
manifest = {'through': END.isoformat(), 'fetchedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'files': []}
session = requests.Session()
session.headers.update({'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json,text/plain,*/*'})

def save(name, url, response, count):
    response.raise_for_status()
    path = ROOT / name
    path.write_bytes(response.content)
    manifest['files'].append({'file': name, 'url': url, 'sha256': hashlib.sha256(response.content).hexdigest(), 'rows': count})
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(name, count, flush=True)
    time.sleep(1)

session.get('https://www.nseindia.com/companies-listing/corporate-filings-actions', timeout=25).raise_for_status()
session.headers['Referer'] = 'https://www.nseindia.com/companies-listing/corporate-filings-actions'
for year in range(2020, END.year + 1):
    start, end = dt.date(year, 1, 1), min(dt.date(year, 12, 31), END)
    url = 'https://www.nseindia.com/api/corporates-corporateActions'
    response = session.get(url, params={'index': 'equities', 'from_date': start.strftime('%d-%m-%Y'), 'to_date': end.strftime('%d-%m-%Y')}, timeout=30)
    response.raise_for_status()
    rows = response.json()
    if not isinstance(rows, list) or not rows:
        raise ValueError('No corporate-action records: ' + str(year))
    for row in rows:
        date = dt.datetime.strptime(row['exDate'], '%d-%b-%Y').date()
        if not start <= date <= end:
            raise ValueError('Corporate-action response did not honor the requested dates')
    save(f'actions-{year}.json', response.url, response, len(rows))

session.headers['Referer'] = 'https://www.niftyindices.com/reports/historical-data'
session.get(session.headers['Referer'], timeout=25).raise_for_status()
for year in range(2020, END.year + 1):
    start, end = dt.date(year, 1, 1), min(dt.date(year, 12, 31), END)
    url = 'https://www.niftyindices.com/BackPage/getHistoricaldatatabletoString'
    payload = {'name': 'NIFTY 500', 'startDate': start.strftime('%d-%b-%Y'), 'endDate': end.strftime('%d-%b-%Y'), 'indexName': 'NIFTY 500'}
    response = session.post(url, json={'cinfo': json.dumps(payload)}, timeout=30)
    response.raise_for_status()
    rows = response.json()
    if isinstance(rows, str):
        rows = json.loads(rows)
    if not isinstance(rows, list) or not rows:
        raise ValueError('No benchmark records: ' + str(year))
    dates = set()
    for row in rows:
        date = dt.datetime.strptime(row['HistoricalDate'], '%d %b %Y').date()
        if not start <= date <= end or row['INDEX_NAME'].upper() != 'NIFTY 500' or date in dates:
            raise ValueError('Invalid benchmark date or identity')
        dates.add(date)
    save(f'nifty500-{year}.json', url, response, len(rows))
print('Official action and price-index downloads complete.', flush=True)

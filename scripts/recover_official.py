#!/usr/bin/env python3
"""Refresh through an independent local network, publishing only newer daily inputs.
Runs in a disposable checkout so automated recovery cannot overwrite local work.
Use the same Python environment as fetch_daily.py (requests, pandas, yfinance).
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = 'https://github.com/zoeyzhu97/crisis-monitor-v2-1.git'
KEYS = ('credit_spread', 'uk_10y')

def improves(old, new):
    for key in KEYS:
        before = old.get('meta', {}).get(key, {}).get('as_of', '')
        after = new.get('meta', {}).get(key, {}).get('as_of', '')
        if after > before:
            return True
        if after and after == before and new['values'].get(key) != old['values'].get(key):
            return True
    return False


def main():
    for attempt in range(3):
        with tempfile.TemporaryDirectory(prefix='crisis-official-') as folder:
            checkout = Path(folder) / 'repo'
            subprocess.run(['git', 'clone', '--quiet', '--depth', '1', REPO, str(checkout)], check=True)
            def run(*args, check=True):
                return subprocess.run(args, cwd=checkout, check=check)
            data = checkout / 'public/data/latest.json'
            before = json.loads(data.read_text())
            run(sys.executable, 'scripts/fetch_daily.py')
            after = json.loads(data.read_text())
            if not improves(before, after):
                print('NO_CHANGE: cloud already holds the latest daily observations available here.')
                return
            run('git', 'config', 'user.name', 'crisis-monitor-recovery')
            run('git', 'config', 'user.email', 'bot@users.noreply.github.com')
            run('git', 'add', 'public/data')
            run('git', 'commit', '-m', 'data: recover newer official observations via independent network')
            if run('git', 'push', 'origin', 'HEAD:main', check=False).returncode:
                continue  # concurrent cloud update: restart against its latest data
            run('gh', 'workflow', 'run', 'daily.yml', '--repo', 'zoeyzhu97/crisis-monitor-v2-1')
            print('PUBLISHED: newer observations pushed; daily-update dispatched.')
            return
    raise RuntimeError('Concurrent updates prevented recovery after three attempts.')

if __name__ == '__main__':
    main()

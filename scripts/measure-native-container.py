"""Run the built Next server and synthetic integration suite in one limited cgroup."""
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request

out = Path('.vercel/review/pdf24-research')
out.mkdir(parents=True, exist_ok=True)
def read(name):
    file = Path('/sys/fs/cgroup')/name
    return file.read_text().strip() if file.exists() else None
def health():
    try:
        with urllib.request.urlopen('http://127.0.0.1:3000/api/health', timeout=5) as response:
            return response.status == 200
    except Exception:
        return False

summary = {'memoryLimit':read('memory.max'),'cpuLimit':read('cpu.max'),
           'eventsBefore':read('memory.events'),'samples':[], 'passed':False}
def usage():
    stats = dict(line.split() for line in (read('memory.stat') or '').splitlines())
    processes = []
    for status in Path('/proc').glob('[0-9]*/status'):
        try:
            fields = dict(line.split(':',1) for line in status.read_text().splitlines() if ':' in line)
            processes.append({'name':fields.get('Name','').strip(),'rssKiB':int(fields.get('VmRSS','0 kB').split()[0])})
        except (OSError,ValueError):
            pass
    return {'anon':stats.get('anon'),'file':stats.get('file'),'kernel':stats.get('kernel'),
            'processes':sorted(processes,key=lambda p:p['rssKiB'],reverse=True)[:8]}
serverlog = (out/'linux-server.txt').open('w')
testlog = (out/'linux-integration.txt').open('w')
server = subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1'],stdout=serverlog,stderr=subprocess.STDOUT)
job = None
start = time.monotonic()
try:
    while not health():
        if server.poll() is not None or time.monotonic()-start>120:
            raise RuntimeError('Next health check did not become ready')
        time.sleep(1)
    summary['idleBytes']=read('memory.current')
    job = subprocess.Popen(['node','node_modules/tsx/dist/cli.mjs','scripts/test-native-engines.ts'],stdout=testlog,stderr=subprocess.STDOUT)
    while job.poll() is None:
        phase = (out/'linux-integration.txt').read_text().splitlines()
        sample = {'seconds':round(time.monotonic()-start,1),'bytes':read('memory.current'),
                  'phase':phase[-1] if phase else 'starting',**usage()}
        summary['samples'].append(sample)
        if server.poll() is not None:
            raise RuntimeError('Next server stopped during processing')
        if time.monotonic()-start>1400:
            raise RuntimeError('Container validation timed out')
        time.sleep(.5)
    summary['exitCode']=job.returncode
    summary['healthAfter']=health()
    summary['passed']=job.returncode==0 and summary['healthAfter']
finally:
    summary['seconds']=round(time.monotonic()-start,2)
    summary['peakBytes']=read('memory.peak')
    summary['eventsAfter']=read('memory.events')
    summary['cpuStats']=read('cpu.stat')
    summary['largestSample']=max(summary['samples'],key=lambda p:int(p['bytes']),default=None)
    if job and job.poll() is None:
        job.kill()
        job.wait()
    server.terminate()
    try:
        server.wait(timeout=10)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait()
    serverlog.close()
    testlog.close()
    (out/'linux-resources.json').write_text(json.dumps(summary,indent=2))
    print(json.dumps({k:v for k,v in summary.items() if k!='samples'},indent=2))
if not summary['passed']:
    raise SystemExit(1)

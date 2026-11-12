#!/usr/bin/env python3
"""Atomically add one synthetic RFC822 message; only fixture states are accepted."""
import argparse, fcntl, json, os, re, tempfile
from datetime import datetime, timezone
from pathlib import Path
from make_state import message
p=argparse.ArgumentParser();p.add_argument('--state',required=True);p.add_argument('--mailbox',type=int,choices=[1,2,3],required=True);p.add_argument('--kind',required=True);p.add_argument('--recipients-json');a=p.parse_args()
if not re.fullmatch(r'(new|reply|attachment|read|rollback|cross-(mail|race)|policy-(archived|sent|spam|trash|draft)|timing-[0-9]{2})',a.kind):p.error('invalid fixture kind')
path=Path(a.state).resolve(strict=True)
if not re.fullmatch(r'/tmp/mail-arrival-[a-z0-9-]{8,40}/state\.json',str(path)):p.error('fixture state path required')
with open(str(path)+'.lock','a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 state=json.loads(path.read_text());run=state['run'];account=f'fixture-{a.mailbox}';rows=state['accounts'][account]['folders']['INBOX']['messages']
 if any(x['message_id']==f'{run}-{a.mailbox}-{a.kind}@arrival.invalid' for x in rows):raise SystemExit('fixture already exists')
 recipients=json.loads(a.recipients_json) if a.recipients_json else None
 if a.kind in ('cross-mail','cross-race') and (a.mailbox!=1 or not isinstance(recipients,list) or len(recipients)!=2 or any(not isinstance(x,str) or not re.fullmatch(r'[^@\s]+@[^@\s]+',x) for x in recipients)):p.error('cross-mail requires two fixture mailbox recipients')
 if a.kind not in ('cross-mail','cross-race') and recipients is not None:p.error('recipients only allowed for cross-mail')
 uid=max((x['uid'] for x in rows),default=0)+1;record=message(run,a.mailbox,a.kind,uid,recipients)
 # Receipt is bounded by the timestamp before write and the timestamp after atomic rename.
 record['received_at']=datetime.now(timezone.utc).isoformat();rows.append(record)
 fd,tmp=tempfile.mkstemp(prefix='.state-',dir=path.parent)
 try:
  with os.fdopen(fd,'w') as out:json.dump(state,out);out.flush();os.fsync(out.fileno())
  os.chmod(tmp,0o600);os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
 published_at=datetime.now(timezone.utc).isoformat()
 print(json.dumps({'run':run,'mailbox':a.mailbox,'kind':a.kind,'uid':uid,'provider_received_before':record['received_at'],'provider_received_after':published_at,'message_id':record['message_id'],'identity':'gmail:'+record['gmail_msgid']}))
